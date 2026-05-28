# WhatsApp Real Estate Group Scraper + Dashboard

A production-oriented WhatsApp listing ingestion and analytics platform for real estate groups.

## 1. PROJECT IDENTITY

- Repository: `LISTINGlisting-aggregator`
- Purpose: ingest real estate WhatsApp group messages, extract structured listings, and expose them through an authenticated dashboard.
- Audience: internal ops/real-estate analysts who need fast visibility into group-sourced rental/sale listings.

## 2. BUSINESS PROBLEM

This codebase solves the problem of capturing unstructured real-estate offers from WhatsApp groups and turning them into searchable, filterable property data. It handles QR-based WhatsApp session onboarding, live group monitoring, historical backfill, structured extraction, and a user-facing dashboard.

## 3. ARCHITECTURE OVERVIEW

The system is split into three primary layers:

- **Ingestion layer**: WhatsApp session manager + QR auth + SSE events.
- **Processing layer**: LLM + regex parser + queue-backed parse worker.
- **Delivery layer**: authenticated Express API + React dashboard + metrics.

The current architecture is hybrid:

- `data/db/listings.db` remains the legacy SQLite source of truth for raw messages and scraper state.
- Postgres (via `src/db/postgres`) is the new primary store for structured listings, users, groups, and analytics.
- A dual-write layer bridges SQLite and Postgres during the migration transition.

## 4. BACKEND COMPONENTS

- `src/api/server.js`: Express server, CSP + Helmet, rate limiting, Prometheus metrics, static SPA serving.
- `src/api/routes/whatsapp.js`: WhatsApp-related API surface for QR stream, connect, status, groups, group selection, disconnect, rescrape, and reparse.
- `src/api/middleware/auth.js`: Clerk JWT authenticate middleware for normal routes and SSE-authenticated `qr-stream`.
- `src/api/services/cacheService.js`: Redis-first cache with in-memory fallback.
- `src/api/middleware/circuitBreaker.js`: circuit breaker protecting WhatsApp QR initiation.
- `src/api/middleware/auditLog.js`: request audit logging.

## 5. WHATSAPP INGESTION PIPELINE

- The app uses a subprocess-based bridge in `src/scraper/whatsapp-qr-bridge.js`.
- Each authenticated user gets a dedicated bridge process and auth directory under `data/wwebjs-auth/<userId>`.
- WhatsApp events are written to `data/wwebjs-state/<userId>.jsonl` and streamed back to the dashboard over SSE.
- The bridge uses `@wppconnect-team/wppconnect` with Puppeteer to manage WhatsApp Web sessions.
- A parent command channel writes commands to a file that the bridge polls for (`rescrape`, `disconnect`, `start_monitoring`, `get_groups`).

## 6. PARSING LAYER

- `src/scraper/dual-parser.js` combines two LLM sources:
  - `src/scraper/llm-parser.js` → Groq (Llama 3.1 8B Instant)
  - `src/scraper/gemini-parser.js` → Google Gemini 2.0 Flash
- Reconciliation is field-level: agreement improves confidence, disagreement applies domain-aware tiebreakers.
- `src/scraper/message-parser.js` is the regex fallback and market-aware extractor for price, location, bedrooms, unit type, and currency.
- `src/worker/parseWorker.js` dequeues raw WhatsApp messages from Upstash Redis and writes structured listings to Postgres.
- `src/db/dualWrite.js` enqueues parse jobs and ensures existing raw messages are persisted to SQLite first, then Postgres best-effort.

## 7. DATABASES

### SQLite (legacy)

- Primary path for existing raw message capture and legacy scraper state.
- Stored in `data/db/listings.db`.
- Main legacy tables include:
  - `raw_messages`
  - `listings`
  - `whatsapp_sessions`
  - `selected_groups`
  - `scraper_status`
  - `digests`

### Postgres (current primary for listings)

- Connection via `src/db/postgres/pool.js` using `DATABASE_URL`.
- Current Postgres store is user-scoped and multi-tenant.
- Key Postgres tables include:
  - `users`
  - `raw_messages`
  - `listings`
  - `monitored_groups`
  - `parse_jobs`
  - `daily_stats`

## 8. AUTHENTICATION & SECURITY

- Frontend auth is handled with Clerk (`@clerk/react` and `@clerk/express`).
- Backend protects API routes with JWT verification using Clerk public key or `CLERK_JWT_KEY`.
- SSE `qr-stream` uses token-in-query due EventSource header limitations.
- `helmet` enforces a restrictive CSP and security headers.
- CORS is strictly allowlisted by origin via `CORS_ORIGINS`.
- Media access (`/api/media/:filename`) is authenticated and sanitized.

## 9. DASHBOARD / UI

- Leverages `dashboard/` as a separate Vite app.
- Built assets are served from `dashboard/dist` by Express.
- Key UI flows:
  - Clerk sign-in
  - scraper QR connection and group selection
  - dashboard listing search, filters, and summary cards
  - listing detail page with AI-generated property summary
  - scraper status and agent/group analytics

## 10. ROUTING & API CONTRACTS

### Public endpoints

- `GET /health` → readiness check, verifies Postgres connectivity.
- `GET /api/v1/metrics` → Prometheus metrics.

### Authenticated API

- `GET /api/scraper/status` → scraper connection + group counts.
- `GET /api/listings/today` → paginated listing feed with filters: `location`, `min_price`, `max_price`, `property_type`, `agent_phone`, `furnished`, `intent`, `unit_type`, `bedrooms`, `rent_period`, `limit`, `offset`.
- `GET /api/listings/filters` → dynamic filter values for the current user.
- `GET /api/listings/:id` → listing detail.
- `GET /api/listings/:id/summary` → AI-generated property summary.
- `GET /api/agents` → aggregated agent listing counts.
- `GET /api/groups` → listing counts per group.
- `GET /api/v1/search` → full-text search via Postgres `fts`.
- `GET /api/v1/digests/:date` → daily digest rows.

### WhatsApp control endpoints

- `POST /api/v1/whatsapp/initiate-qr` → start QR login.
- `GET /api/v1/whatsapp/qr-stream?token=` → SSE stream for QR/auth state.
- `GET /api/v1/whatsapp/status` → current session status.
- `GET /api/v1/whatsapp/groups` → fetch connected WhatsApp groups.
- `POST /api/v1/whatsapp/select-groups` → save selected groups.
- `POST /api/v1/whatsapp/disconnect` → disconnect WhatsApp session.
- `POST /api/v1/whatsapp/rescrape` → historical backfill for selected groups.
- `POST /api/v1/whatsapp/reparse` → delete and requeue user raw messages for parsing.

## 11. ENVIRONMENT & CONFIGURATION

### Required environment variables

- `PORT` — Express HTTP port (default `3000`).
- `DB_PATH` — path to SQLite DB (default `data/db/listings.db`).
- `DATABASE_URL` — Postgres connection string.
- `GROQ_API_KEY` — Groq LLM key for parser and summary generation.
- `GEMINI_API_KEY` — Gemini key for dual-parser.
- `CLERK_SECRET_KEY` — Clerk backend client secret.
- `CLERK_JWT_KEY` — Clerk JWT verification public key.
- `REDIS_URL` — optional Redis connection for cache fallback.
- `CORS_ORIGINS` — optional comma-separated allowed front-end origins.
- `PG_SSL_REJECT_UNAUTHORIZED` — optional TLS setting for Postgres.

### Config file

- `src/config/app.js` defines env-specific rate limits and cache TTL values.

## 12. RUNNING LOCALLY

1. Install root dependencies:
   ```bash
   npm install
   cd dashboard && npm install
   ```
2. Build the dashboard:
   ```bash
   cd dashboard && npm run build
   cd ..
   ```
3. Initialize SQLite schema:
   ```bash
   npm run init-db
   npm run migrate
   ```
4. If using Postgres, run Postgres migrations:
   ```bash
   npm run migrate:pg
   ```
5. Start the web server:
   ```bash
   npm start
   ```
6. Run the parse worker separately:
   ```bash
   npm run worker:parse
   ```

## 13. BUILD & DEPLOYMENT

- The backend is started from `src/api/server.js`.
- The SPA is built from `dashboard/` into `dashboard/dist`.
- Docker/Kubernetes artifacts are present in `docker-compose.yml`, `docker-compose.monitoring.yml`, and `k8s/`.
- The Express server serves the SPA and exposes `/api/*` and `/api/v1/metrics`.

## 14. MONITORING & OBSERVABILITY

- Prometheus metrics are exposed at `/api/v1/metrics`.
- `prom-client` collects default process metrics plus request duration, request count, WhatsApp client count, cache stats, and circuit breaker state.
- Winston logging is configured via `src/config/logger.js`.

## 15. DATA FLOW

1. WhatsApp bridge receives group messages and persists raw events to SQLite.
2. `src/db/dualWrite.js` also writes raw rows to Postgres and enqueues `parse:listings` jobs.
3. `src/worker/parseWorker.js` consumes messages, runs the dual LLM parser, and inserts structured listings into Postgres.
4. Dashboard and API consumers read from Postgres for user-scoped listings, search, agents, groups, and digests.
5. Media blobs are saved under `data/media/` and served authenticated via `/api/media/:filename`.

## 16. OPERATIONAL CONSIDERATIONS

- `REDIS_URL` is optional; without it, the app uses in-memory cache.
- `@wppconnect-team/wppconnect` runs inside a forked subprocess to isolate Puppeteer and avoid Express process crashes.
- `whatsappBreaker` protects QR initiation from repeated failures.
- `data/wwebjs-state` and `data/wwebjs-auth` contain session state and must be persisted if running long-lived sessions.

## 17. MAINTENANCE NOTES

- Use `npm run worker:parse` for current queue processing.
- Keep `GROQ_API_KEY` and `GEMINI_API_KEY` healthy; parser and summary generation both depend on them.
- Rebuild the dashboard after UI changes:
  ```bash
  cd dashboard && npm run build
  ```
- If Postgres is not yet populated for a Clerk user, listing endpoints return an empty result set until the user scrapes messages.

## 18. LEGACY / DEPRECATED CODE

These modules are present but no longer the primary path:

- `src/worker/messageWorker.js` — deprecated BullMQ worker for old Redis/Bull queue.
- `src/scraper/whatsapp-scraper.js` — legacy WhatsApp scraper using `whatsapp-web.js`.
- `src/scraper/whatsapp-client.js` — old standalone WhatsApp client setup.
- `src/config/appConfig.js` — currently not imported by the main server.

## 19. CODEBASE LANDMARKS

- `src/api/server.js` — main application entrypoint.
- `src/api/routes/whatsapp.js` — WhatsApp control and SSE surface.
- `src/scraper/whatsapp-qr-bridge.js` — subprocess bridge implementation.
- `src/worker/parseWorker.js` — current job consumer for structured listing extraction.
- `src/db/dualWrite.js` — migration bridge between SQLite and Postgres.
- `dashboard/src/pages/ListingDetailPage.tsx` — listing detail and summary UI.

## 20. GLOSSARY

- **Bridge**: subprocess that runs WhatsApp Web session logic.
- **SSE**: Server-Sent Events used for QR scan / status updates.
- **Dual write**: writes to SQLite first, then Postgres best-effort.
- **Parse queue**: Upstash queue `parse:listings` for raw message parsing.
- **Groq**: LLM service used for structured extraction and summaries.
- **Gemini**: secondary LLM used in consensus parsing.
- **Clerk**: third-party auth provider for the dashboard.
- **wppconnect**: WhatsApp Web automation library used in the bridge.
- **`data/media/`**: persisted media assets from WhatsApp messages.
- **`dashboard/dist`**: built frontend assets served by Express.
- **`/api/v1/metrics`**: Prometheus scrape endpoint.

