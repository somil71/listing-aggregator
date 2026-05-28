# Property Digest — Architecture
**Last updated:** 2026-05-28 (Phase 3 hardening complete)

A multi-tenant WhatsApp listing aggregator. Users connect their WhatsApp Web
session, select groups to monitor, and the system parses incoming messages
into structured real-estate listings using a dual-LLM pipeline (Groq + Gemini)
with a regex fallback.

## High-level data flow

```
                                  ┌──────────────────────────┐
   WhatsApp Web ────────────────► │ wppconnect Bridge (1/user)│
                                  └────────────┬─────────────┘
                                               │
                                  ┌────────────▼─────────────┐
                                  │  bridgeBus (Redis stream)│
                                  │   ← cmd  /  events →     │
                                  └────────────┬─────────────┘
                                               │
   ┌──────────┐    ┌──────────┐     ┌──────────▼──────────┐
   │  React   │────│  Express │─────│  whatsappService    │
   │ Dashboard│SSE │   API    │     │  (multi-instance via│
   └──────────┘    └─────┬────┘     │  bridgeLease)       │
                         │           └──────────┬──────────┘
                  ┌──────▼──────┐               │
                  │ cacheService│   ┌───────────▼────────────┐
                  │  (Redis +   │   │   dualWrite — raw_msgs │
                  │  in-memory) │   │   → Postgres            │
                  └─────────────┘   │   → Upstash parse queue │
                                    └──────────┬──────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │  parseWorker (n replicas)   │
                                │   ↳ Groq + Gemini parsers   │
                                │   ↳ DLQ with retry          │
                                └──────────────┬──────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │   Postgres (Neon)            │
                                │   listings + daily_stats     │
                                └──────────────────────────────┘
```

## Key components

### Backend (`src/api/`)
- **`server.js`** — Express entry point. Helmet CSP with per-request nonce,
  CORS allowlist, rate limiting, request-id middleware, per-request timeout,
  Prometheus metrics, graceful SIGTERM shutdown.
- **`middleware/auth.js`** — Clerk JWT verification + Redis-backed SSE
  one-time nonce store (multi-instance safe).
- **`middleware/circuitBreaker.js`** — Per-dependency circuit breakers
  (whatsapp, postgres, llm) with HALF_OPEN probe-once guard.
- **`middleware/auditLog.js`** — Fire-and-forget audit trail to Postgres.
  IP from `req.socket.remoteAddress` only (no `x-forwarded-for` trust).
- **`services/cacheService.js`** — Redis-first cache with in-memory fallback.
- **`services/bridgeLease.js`** — Redis-backed distributed ownership lease
  so only one instance spawns a bridge per user.
- **`services/bridgeBus.js`** — HMAC-signed event publish + command channel
  (Redis pub/sub + stream) with filesystem fallback for dev.
- **`services/whatsappService.js`** — Bridge subprocess lifecycle, SSE
  fan-out, group/session management.

### Bridge subprocess (`src/scraper/whatsapp-qr-bridge.js`)
Spawned per user. Runs wppconnect under headless Chromium. Persists
messages via `dualWrite.writeRawMessage` (Postgres + SQLite mirror).
Communicates with parent via `bridgeBus` (Redis) or `.jsonl`/`.cmd` files
(dev fallback). HMAC-signed event envelopes.

### Parse worker (`src/worker/parseWorker.js`)
Consumes the `parse:listings` Upstash queue via BRPOP. Runs the
`DualParser` (Groq + Gemini consensus + regex fallback). Writes to
Postgres `listings` table with `ON CONFLICT (raw_message_id) DO NOTHING`.
Failed jobs are retried with exponential backoff up to `PARSE_MAX_ATTEMPTS`,
then promoted to `'dead'` status for operator inspection.

### Frontend (`dashboard/src/`)
Vite + React 18 + Tailwind. Auth via `@clerk/react`. SSE for QR code
delivery + backfill progress. Server-side analytics aggregation.

## Storage

| Store | Used for | Owner |
|-------|----------|-------|
| **Postgres (Neon)** | listings, raw_messages, users, monitored_groups, daily_stats, audit_log, parse_jobs | source of truth |
| **SQLite (local)** | bridge-side cache during ingestion (legacy, being phased out) | bridge subprocess only |
| **Redis (Upstash + self-hosted)** | cache, SSE nonces, bridgeLease, bridgeBus, parse queue | coordination layer |

## Multi-instance deployment

The app is horizontally scalable when Redis is configured:

1. **bridgeLease** — `SET NX EX` ensures only one instance spawns Chromium
   per user. Other instances return 409 Conflict with the owning instance's
   ID so the LB / client can re-route.
2. **bridgeBus pub/sub** — bridge events are published to a Redis channel
   keyed by userId. Any instance with an active SSE connection for that
   user subscribes and forwards.
3. **SSE nonces** — stored in Redis with `GETDEL` (atomic consume), so a
   nonce minted by instance A is validated by instance B.
4. **Cache** — all read caches go through Redis when available; consistent
   per-key across instances.

## Observability

- **OpenTelemetry** — auto-instrumented HTTP, PG, Redis, fetch. OTLP/HTTP
  exporter to whatever collector `OTEL_EXPORTER_OTLP_ENDPOINT` points at.
- **Winston logger** — JSON structured, includes `trace_id`/`span_id` when
  OTel is active. Per-request `X-Request-Id` correlation.
- **Prometheus** — `/api/v1/metrics` (token-gated). Tracks:
  - HTTP duration histogram + count
  - Circuit breaker state per dependency
  - Active WhatsApp clients
  - Queue depth
  - SSE failures, LLM timeouts, bridge reconnects
  - PG pool saturation
  - Cache hits/misses
- **CSP violation reports** — `POST /api/csp-report` captures browser-side
  CSP violations for monitoring.

## Security model

- **Auth** — Clerk JWTs verified offline using embedded RSA public key. SSE
  uses short-lived (60s) single-use nonces minted via Bearer-authed POST.
- **CSP** — Per-request nonce with `strict-dynamic`. No `'unsafe-inline'`
  on scriptSrc. Violation reports flow to `/api/csp-report`.
- **CORS** — Strict allowlist; localhost only when explicitly added via
  `CORS_ORIGINS`.
- **HMAC-signed IPC** — bridgeBus events and commands are HMAC-signed so a
  shared filesystem (Docker volume) can't be used to inject fake bridge
  events from a compromised neighbour.
- **Rate limiting** — Global limiter + tight per-endpoint limits on search
  and the destructive `/reparse` (2 calls per user per hour).
- **Confirmation header** — `/reparse` requires `X-Confirm-Reparse: true` so
  a buggy fetch can't wipe a user's listings.
- **No secrets in URLs** — SSE uses one-time nonces, never JWTs.
- **Audit trail** — every read/write action logged to Postgres with
  socket-level IP, action type, resource ID, request ID.

## CI/CD

`.github/workflows/`:
- **ci.yml** — lint, typecheck, unit tests, npm audit, gitleaks secret scan,
  Trivy Docker image scan, Semgrep SAST.
- **codeql.yml** — weekly CodeQL security scan with security-extended queries.
- **dependabot.yml** — weekly dependency updates grouped by patch/minor.

## Deployment

- **Local dev**: `npm run dev` (backend) + `cd dashboard && npm run dev`.
- **Docker Compose**: `docker compose up` — Redis with `requirepass`, app +
  worker share a network with internal Redis; `REDIS_PASSWORD` required.
- **Kubernetes**: `k8s/` manifests with HPA, ConfigMap, Secret (templated).

## Runbook reference

See `RUNBOOK.md` for incident response, common failure modes, and recovery
procedures.
