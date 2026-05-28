# LISTINGlisting-aggregator Audit

Date: 2026-05-27
Auditor: Codex
Workspace: `d:\LISTING\LISTINGlisting-aggregator`

## Executive Summary

This project is not feature-complete in its current state. The codebase contains two overlapping architectures:

1. A legacy SQLite + direct scraper flow that powers the current API and dashboard.
2. A newer Postgres + Upstash + worker flow that is only partially wired through.

Because those two paths do not terminate in the same storage and queue pipeline, the system can appear to work in parts while silently dropping or hiding data in others. The biggest risk is not one isolated bug; it is architectural split-brain.

Current overall status:

- Frontend build: passes
- External Postgres connectivity: passes
- External Upstash REST connectivity: passes
- Local backend runtime: unstable
- Local SQLite access: currently blocked by file locking
- End-to-end ingestion path: incomplete / mismatched
- Monitoring path: incomplete
- Secret handling: unsafe

## What I Verified

I audited:

- Backend routes and middleware in `src/api`
- SQLite schema and migrations in `src/db`
- Postgres schema and migration path in `src/db/postgres`
- WhatsApp service and QR/group flows
- Worker and queue implementations
- Docker and Kubernetes deployment manifests
- Frontend integration points
- Current local ports and external service reachability
- Existing logs and recent runtime behavior

Commands / checks performed:

- Read runtime/config, API, DB, worker, queue, Docker, K8s, and dashboard source
- Built frontend with `npm run build` in `dashboard`
- Attempted backend start with `node src/api/server.js`
- Ran `node tests/db_integrity.js`
- Queried Postgres directly with `pg`
- Verified Upstash REST `/ping`
- Checked listening local ports
- Reviewed `d:\LISTING\logs\app.log` and `d:\LISTING\logs\error.log`

## Runtime Snapshot

### Local ports

At audit time, the only confirmed local listening app port was:

- `5173` - Vite dev server

Not listening locally during audit:

- `3000` - Express API
- `6379` - local Redis
- `9090` - Prometheus
- `9093` - Alertmanager
- `3001` - Grafana
- `9121` - Redis exporter
- `5432` - local Postgres

### External connectivity

Verified live:

- Neon Postgres TCP reachable on `5432`
- Upstash REST reachable and returned `{"result":"PONG"}`
- Postgres query `select now()` succeeded

### Local blockers

The local SQLite database was locked during the audit by a running process:

- `node scripts/purge_test_data.js`

This mattered because:

- `node src/api/server.js` failed to start with `SQLITE_BUSY`
- `node tests/db_integrity.js` failed with `SQLITE_BUSY`
- even read-only SQLite inspection failed with `SQLITE_BUSY`

This is partly environmental, but the application is not resilient to it.

## Top Findings

## 1. Critical: real secrets are committed in local env files

Evidence:

- `.env:7` contains `DATABASE_URL`
- `.env:11` contains `UPSTASH_REDIS_REST_TOKEN`
- `.env:15` contains `GROQ_API_KEY`
- `.env:20` contains `CLERK_SECRET_KEY`
- `dashboard/.env.local:2` contains `CLERK_SECRET_KEY`

Impact:

- Immediate credential exposure risk
- Frontend folder includes a server secret it should never have
- If this repository is shared, backed up, or pushed, all connected systems should be treated as compromised

Severity: Critical

Required action:

- Rotate Clerk secret, Groq key, Upstash token, and Postgres credentials
- Remove secrets from tracked files
- Add proper `.env.example` and git ignore rules
- Confirm no client bundle path ever consumes `CLERK_SECRET_KEY`

## 2. Critical: ingestion path is split across two incompatible architectures

Evidence:

- `src/db/dualWrite.js:1-2` explicitly says SQLite is current and listings are Postgres-only going forward
- `src/db/dualWrite.js:111` enqueues parse jobs to `parse:listings`
- `src/worker/parseWorker.js:55` writes parsed listings into Postgres
- `src/api/server.js` listing/search/agent/group endpoints all query SQLite through `src/api/db-helpers.js`
- `src/scraper/whatsapp-scraper.js:73` writes listings directly into SQLite in the legacy path

Why this is broken:

- New pipeline: WhatsApp bridge -> dualWrite -> Postgres raw_messages -> Upstash parse queue -> parseWorker -> Postgres listings
- Current API/dashboard read path: SQLite only

Result:

- Data written by the new Postgres pipeline does not automatically show up in the dashboard/API
- Data written by the legacy scraper may appear in the dashboard but bypass the new multi-user architecture
- You currently have two truths, not one

Severity: Critical

Required action:

- Choose one source of truth now
- Either migrate API reads to Postgres, or stop writing listings only to Postgres
- Remove the half-migrated dual path once the final store is chosen

## 3. Critical: deployed worker is the wrong worker for the active parse queue

Evidence:

- `src/db/dualWrite.js:14` queue name is `parse:listings`
- `src/worker/parseWorker.js:110` consumes `parse:listings`
- `src/queue/messageQueue.js:14` BullMQ queue name is `message-processing`
- `src/worker/messageWorker.js:95` consumes `message-processing`
- `k8s/worker-deployment.yaml:22` deploys `node src/worker/messageWorker.js`
- `docker-compose.yml` worker service also starts `messageWorker.js`

Why this is broken:

- The code that enqueues new parse work is not sending to the queue the deployed worker consumes
- The worker you deploy is built for the old BullMQ/SQLite path, not the new Upstash/Postgres path

Result:

- New raw messages can pile up without being parsed by the deployed worker fleet
- Production may look healthy while ingesting nothing useful downstream

Severity: Critical

Required action:

- Deploy `parseWorker.js` if `dualWrite.js` is the intended ingestion path
- Or stop enqueuing to Upstash and keep BullMQ consistently
- Do not keep both queue stacks unless there is a real migration switch and observability around it

## 4. High: backend startup is brittle because SQLite locking can kill the service

Evidence:

- `src/api/server.js:71-80` runs SQLite migrations on every startup via `db.exec(...)`
- `d:\LISTING\logs\error.log` shows repeated `Server failed to start` with `SQLITE_BUSY: database is locked`
- `src/api/middleware/auditLog.js` also writes to SQLite on response finish
- `d:\LISTING\logs\error.log:1` shows `Audit log insert failed` with `SQLITE_BUSY`

Impact:

- Startup is non-deterministic when any other process holds the DB
- Runtime writes can fail after successful requests
- Health and audit behavior depend on file-lock timing, not just app correctness

Severity: High

Required action:

- Add SQLite busy timeout / retry handling
- Enable WAL mode and revisit concurrent write patterns
- Stop running migrations on every boot if SQLite remains shared
- Prevent ad hoc maintenance scripts from competing with the live app

## 5. High: `messageWorker.js` does not match the current SQLite schema

Evidence:

- `src/worker/messageWorker.js:37` writes to `listings_failed`
- `src/worker/messageWorker.js:46-48` inserts `user_id`, `group_id`, `message_timestamp` into `raw_messages`
- `src/db/schema.sql` defines `raw_messages` columns as `id, group_name, sender_name, message_text, timestamp, has_images, image_count, image_paths, created_at`
- `src/db/schema.sql` does not define `listings_failed`

Impact:

- If `messageWorker.js` runs against the checked-in SQLite schema, writes will fail or be no-ops depending on SQL path
- The old worker path is not deployable from a clean database without undocumented schema drift

Severity: High

Required action:

- Align worker SQL with the real schema
- Or remove the old worker entirely if Postgres is the intended target

## 6. High: monitoring configuration cannot scrape the authenticated metrics endpoint

Evidence:

- `src/api/server.js:161` protects `/api/v1/metrics` with `authenticate`
- `monitoring/prometheus.yml:21` scrapes `/api/v1/metrics`
- `monitoring/prometheus.yml:23` has authorization commented out

Impact:

- Prometheus will get `401` unless manually provided a valid bearer token
- Grafana and alerting will have incomplete or empty application metrics

Severity: High

Required action:

- Either expose metrics internally without Clerk auth
- Or add a dedicated machine token / auth proxy and wire it into Prometheus

## 7. Medium: runtime configuration service exists in Postgres but is not actually wired into runtime decisions

Evidence:

- `src/config/appConfig.js` provides `get`, `getMany`, `set`, `all`, `invalidate`
- `src/db/postgres/002_seed_config.sql` seeds parser/market/bridge/UI config
- search across `src` shows no runtime use of those seeded keys outside the config module itself

Impact:

- Settings are defined as a feature but not operationally used
- The code still relies on hardcoded values in multiple places

Severity: Medium

Required action:

- Wire parser thresholds, market defaults, and bridge timing to `appConfig`
- Or remove the seeded config layer until it is truly live

## 8. Medium: WhatsApp group discovery is operationally fragile and can stall for 95 seconds before failing

Evidence:

- `src/api/services/whatsappService.js:344` hard-timeouts group fetch at 95 seconds
- `d:\LISTING\logs\app.log` recorded `GET /groups` taking `95006ms` and returning `500`

Impact:

- First-time onboarding can feel broken
- Group selection modal depends on a long-polling bridge/file-tail flow that is easy to destabilize

Severity: Medium

Required action:

- Add explicit retry and cancellation semantics
- Surface clearer status and timeout causes in API responses
- Consider a persistent bridge state channel rather than file polling alone

## Feature Completion Audit

### Backend API

Implemented:

- `/health`
- `/api/listings/today`
- `/api/listings/:id`
- `/api/v1/search`
- `/api/v1/digests/:date`
- `/api/agents`
- `/api/groups`
- `/api/scrape-stats`
- `/api/v1/whatsapp/*`
- `/api/v1/metrics`

Assessment:

- Route surface is broad enough for an MVP
- Behavior is not fully production-ready because data ownership is split and metrics/auth conflict with monitoring

### WhatsApp connection flow

Implemented:

- Clerk-authenticated QR start
- SSE QR stream
- Group enumeration
- Selected-group persistence
- Disconnect
- Rescrape trigger

Assessment:

- UX flow exists end-to-end
- Reliability is medium at best due to long group-fetch timeout, file-based bridge coordination, and DB locking side effects

### Dashboard

Verified:

- `dashboard` production build passed successfully on 2026-05-27
- Clerk routes, protected pages, QR modal, group selection modal, and listing table are present

Assessment:

- Frontend is farther along than the backend data plumbing
- UI is usable, but it depends on whichever backend path happens to populate SQLite

### Data platform

SQLite path:

- Present
- Powers current API
- Vulnerable to lock contention

Postgres path:

- Present
- Reachable
- Migrations `001_initial.sql` and `002_seed_config.sql` are applied
- Not yet the read-path source of truth

Assessment:

- Migration to Postgres is incomplete

### Queue / worker system

Present:

- BullMQ + Redis worker path
- Upstash REST queue path

Assessment:

- Incomplete and inconsistent
- Needs consolidation before production use

### Monitoring / ops

Present:

- Prometheus config
- Grafana config
- Alertmanager config
- Docker Compose monitoring stack
- Kubernetes manifests

Assessment:

- Good coverage on paper
- Not operationally complete because metrics auth is incompatible with Prometheus as configured

## Endpoint and Flow Audit

### Public endpoint

- `GET /health`

### Authenticated core endpoints

- `GET /api/v1/metrics`
- `GET /api/scraper/status`
- `GET /api/listings/today`
- `GET /api/listings/:id`
- `GET /api/v1/search`
- `GET /api/v1/digests/:date`
- `GET /api/agents`
- `GET /api/groups`
- `GET /api/scrape-stats`

### WhatsApp endpoints

- `GET /api/v1/whatsapp/qr-stream`
- `POST /api/v1/whatsapp/initiate-qr`
- `GET /api/v1/whatsapp/status`
- `GET /api/v1/whatsapp/groups`
- `POST /api/v1/whatsapp/select-groups`
- `POST /api/v1/whatsapp/disconnect`
- `POST /api/v1/whatsapp/rescrape`

### Logic flow reality

Current supported logic flows in code:

- Legacy scraper flow:
  `whatsapp-web.js client -> SQLite raw_messages -> regex parser -> SQLite listings -> API -> dashboard`

- New migration flow:
  `WhatsApp bridge -> dualWrite SQLite raw_messages + Postgres raw_messages -> Upstash queue -> parseWorker -> Postgres listings`

Current problem:

- Only the legacy path clearly feeds the dashboard
- The newer path clearly feeds Postgres
- The app has no single converged read path

## Port and Connection Audit

### Confirmed local app/service ports in code

- `3000` - Express backend
- `5173` - Vite dev server
- `6379` - Redis
- `3001` - Grafana
- `9090` - Prometheus
- `9093` - Alertmanager
- `9121` - Redis exporter

### Confirmed runtime state during audit

- `5173` listening locally
- `3000` not listening because backend start failed under SQLite lock
- `6379` not listening locally
- monitoring ports not listening locally

### External service verification

- Neon Postgres host reachable on `5432`
- Upstash REST responded successfully

## Testability Audit

Succeeded:

- Frontend build
- Direct Postgres query
- Upstash ping

Blocked / failed:

- `node src/api/server.js` failed with `SQLITE_BUSY`
- `node tests/db_integrity.js` failed with `SQLITE_BUSY`
- Full API test suite was not safely runnable because backend was not stably available during the audit window

Important note:

- This is not just a local-environment inconvenience. The code currently lacks enough protection against SQLite lock contention, so this class of failure is itself a product risk.

## Recommended Remediation Order

1. Rotate all exposed secrets immediately.
2. Decide the single source of truth: SQLite or Postgres.
3. Collapse to one queue/worker path.
4. Fix deployment manifests so the deployed worker matches the active queue.
5. Make SQLite startup/write behavior resilient or remove SQLite from the live path.
6. Align monitoring auth with actual Prometheus scraping.
7. Remove dead/half-migrated code after the architecture choice.
8. Re-run the full endpoint and load audit only after steps 1-6.

## Short Conclusion

The project has a strong amount of implementation work already done, especially in the dashboard, WhatsApp UX, and schema design. The main issue is not missing screens or missing endpoints. The main issue is that the system is halfway through a platform migration, and both halves are active at once.

If you want, the next best step is for me to do one of these two follow-ups:

1. Convert this into a fix plan with exact file-by-file changes and priorities.
2. Start implementing the stabilization work, beginning with secret cleanup, queue/store unification, and backend startup resilience.
