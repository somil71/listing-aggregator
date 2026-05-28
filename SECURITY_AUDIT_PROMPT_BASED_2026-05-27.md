# Prompt-Based Security Audit — LISTINGlisting-aggregator

Date: 2026-05-27
Auditor: Codex
Target: `d:\LISTING\LISTINGlisting-aggregator`
Method: White-box repo audit using the supplied enterprise security audit prompt as the checklist source

## Scope

This audit applies the supplied prompt framework to the `LISTINGlisting-aggregator` project itself.

It does **not** audit the pasted JS/DOCX generator as source code.

## Executive Summary

Using the supplied prompt as the control framework, the project currently fails several high-value checks in these areas:

- Data isolation / IDOR-resistant authorization
- Token handling
- CORS policy
- Secret management
- Container and deployment hardening
- HTTP response hardening

The highest-risk issue remains split authorization behavior: some listing endpoints are properly user-scoped in Postgres, while several authenticated endpoints still read global SQLite data with no user ownership filter.

## Top Findings

### 1. Critical — Authenticated users can access shared cross-tenant data on multiple endpoints

`TEST ID    : SESS-ISO-004 / BL-HORIZ-002 / API-AUTH-001`
`CATEGORY   : Session Isolation / Horizontal Access Control`
`REQUEST    : Authenticated GET /api/v1/search, GET /api/v1/digests/:date, GET /api/agents, GET /api/groups`
`EXPECTED   : Responses must be restricted to the authenticated user's own resources only`
`ACTUAL     : These handlers query shared SQLite tables with no user filter`
`STATUS     : VULN`
`SEVERITY   : CRITICAL`
`EVIDENCE   : [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:389), [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:455), [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:465), [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:481)`
`REMEDIATION: Move these endpoints to the same Postgres user-scoped model used by /api/listings/today and /api/listings/:id, and include user_id in both query filters and cache keys`

### 2. Critical — Real secrets are committed in tracked env files

`TEST ID    : ENC-DAT-003 / LEAK-003 / INF-DEP-002`
`CATEGORY   : Secrets Management`
`REQUEST    : Inspect repository-tracked env files`
`EXPECTED   : Secrets must come from deployment environment or a secrets manager, not tracked files`
`ACTUAL     : `.env` contains live service credentials; `dashboard/.env.local` contains `CLERK_SECRET_KEY``
`STATUS     : VULN`
`SEVERITY   : CRITICAL`
`EVIDENCE   : `.env`, `dashboard/.env.local``
`REMEDIATION: Rotate all exposed credentials immediately, remove secrets from tracked files, add `.env.example`, and ensure frontend folders never contain server-only secrets`

### 3. High — Bearer token is sent in the URL for the SSE flow

`TEST ID    : LEAK-004 / SESS-TOK-004`
`CATEGORY   : Sensitive Data Exposure / Session Handling`
`REQUEST    : GET /api/v1/whatsapp/qr-stream?token=<bearer>`
`EXPECTED   : Auth tokens must never appear in URLs or query strings`
`ACTUAL     : SSE authentication depends on a `token` query parameter, and the frontend constructs that URL directly`
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : [src/api/middleware/auth.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/middleware/auth.js:64), [src/api/routes/whatsapp.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/routes/whatsapp.js:10), [dashboard/src/hooks/useWhatsAppApi.ts](/d:/LISTING/LISTINGlisting-aggregator/dashboard/src/hooks/useWhatsAppApi.ts:65)`
`REMEDIATION: Replace query-string bearer auth with an HttpOnly cookie or a short-lived one-time stream ticket`

### 4. High — CORS reflects arbitrary origins while allowing credentials

`TEST ID    : CORS-001 / CORS-003`
`CATEGORY   : CORS`
`REQUEST    : `curl -i -H "Origin: https://evil.com" http://localhost:3000/api/listings/today``
`EXPECTED   : Unapproved origins should not receive allow headers on authenticated endpoints`
`ACTUAL     : Local runtime returned `Access-Control-Allow-Origin: https://evil.com` and `Access-Control-Allow-Credentials: true``
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:103), live runtime capture on 2026-05-27`
`REMEDIATION: Replace `origin: true` with a strict allowlist of known frontend origins`

### 5. High — Docker image copies `.env` files into the production container

`TEST ID    : INF-CONT-002 / ENC-DAT-003`
`CATEGORY   : Container / Secret Handling`
`REQUEST    : Inspect production image build instructions`
`EXPECTED   : Secrets should be injected at runtime, not baked into image layers`
`ACTUAL     : Dockerfile copies `.env*` into `/app` during build`
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : [Dockerfile](/d:/LISTING/LISTINGlisting-aggregator/Dockerfile:35)`
`REMEDIATION: Remove `COPY .env* ./` from the image build and provide secrets only via runtime env or secret mounts`

### 6. High — Backend JWT validation is offline and does not enforce revocation/logout semantics

`TEST ID    : SESS-LIF-001 / SESS-LIF-004 / SESS-LIF-005`
`CATEGORY   : Session Lifecycle`
`REQUEST    : Replay a previously valid JWT after logout, password change, or user deletion`
`EXPECTED   : Server rejects revoked or invalidated sessions`
`ACTUAL     : Middleware verifies token signature and claims offline and does not check live Clerk session status`
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : [src/api/middleware/auth.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/middleware/auth.js:43)`
`REMEDIATION: Add revocation-aware verification for sensitive API access or validate Clerk session state server-side`

### 7. Medium — Public health endpoint leaks internal runtime details

`TEST ID    : INF-DEP-004 / LEAK-005`
`CATEGORY   : Infrastructure Exposure`
`REQUEST    : `curl -i http://localhost:3000/health``
`EXPECTED   : If public, health should be minimal and avoid detailed internals`
`ACTUAL     : Response includes uptime, listing count, memory profile, cache details, and service state`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:124), live runtime capture on 2026-05-27`
`REMEDIATION: Reduce `/health` to a minimal readiness payload or restrict it to trusted networks/load balancers`

### 8. Medium — Missing standard HTTP hardening headers and Express fingerprint leakage

`TEST ID    : API-HDR-001 / API-HDR-002 / API-HDR-003 / API-HDR-004 / API-HDR-005`
`CATEGORY   : HTTP Security Headers`
`REQUEST    : `curl -i http://localhost:3000/health``
`EXPECTED   : CSP, HSTS, X-Frame-Options, nosniff present; `X-Powered-By` absent`
`ACTUAL     : Response includes `X-Powered-By: Express` and lacks the standard hardening headers`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:102), live runtime capture on 2026-05-27`
`REMEDIATION: Disable `X-Powered-By` and add explicit header hardening, ideally through `helmet` with project-specific CSP tuning`

### 9. Medium — Error responses can expose internal implementation messages

`TEST ID    : INF-ERR-002 / API-HDR-006`
`CATEGORY   : Error Handling`
`REQUEST    : Trigger backend failures on route handlers`
`EXPECTED   : Generic client-safe error messages only`
`ACTUAL     : Multiple routes return `error.message` directly`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:292), [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:360), [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:383), [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:448), [src/api/routes/whatsapp.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/routes/whatsapp.js:39)`
`REMEDIATION: Return generic error envelopes to clients and keep detailed messages only in logs`

### 10. Medium — Postgres TLS verification is explicitly weakened

`TEST ID    : TLS-003`
`CATEGORY   : Transport Security`
`REQUEST    : Inspect database connection TLS settings`
`EXPECTED   : Certificate validation should remain enabled`
`ACTUAL     : Postgres client uses `ssl: { rejectUnauthorized: false }``
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : [src/db/postgres/pool.js](/d:/LISTING/LISTINGlisting-aggregator/src/db/postgres/pool.js:11)`
`REMEDIATION: Use verified CA trust or provider-specific certificate configuration instead of disabling verification`

### 11. Medium — Kubernetes workload requests elevated `SYS_ADMIN` capability

`TEST ID    : INF-CONT-001`
`CATEGORY   : Container / Least Privilege`
`REQUEST    : Inspect runtime container security context`
`EXPECTED   : Container should run with minimum required capabilities`
`ACTUAL     : Deployment adds `SYS_ADMIN` capability to the application container`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : [k8s/deployment.yaml](/d:/LISTING/LISTINGlisting-aggregator/k8s/deployment.yaml:88)`
`REMEDIATION: Revisit Puppeteer runtime strategy and remove `SYS_ADMIN` if possible; if unavoidable, isolate this workload and document the threat tradeoff`

### 12. Medium — Production dependency scan still reports known vulnerabilities

`TEST ID    : INF-DEP-001`
`CATEGORY   : Dependency Security`
`REQUEST    : `cmd /c npm.cmd audit --omit=dev --json``
`EXPECTED   : No high/critical production dependency issues`
`ACTUAL     : One high and multiple moderate vulnerabilities were reported, including `tmp` and transitive issues under `@wppconnect-team/wppconnect``
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : local npm audit run on 2026-05-27`
`REMEDIATION: Upgrade or replace affected packages and verify runtime reachability of the vulnerable paths`

## Verified Passes

### A. Protected API routes reject missing tokens

`TEST ID    : API-AUTH-001`
`CATEGORY   : Auth Enforcement`
`REQUEST    : GET /api/listings/today without Authorization header`
`EXPECTED   : 401`
`ACTUAL     : 401 Unauthorized`
`STATUS     : PASS`
`EVIDENCE   : local runtime capture on 2026-05-27`

### B. `/api/listings/:id` has explicit user scoping in its query

`TEST ID    : SESS-ISO-005`
`CATEGORY   : IDOR Resistance`
`REQUEST    : GET /api/listings/:id`
`EXPECTED   : resource query constrained by authenticated user's ownership`
`ACTUAL     : handler filters with `WHERE l.id = $1 AND l.user_id = $2``
`STATUS     : PASS`
`EVIDENCE   : [src/api/server.js](/d:/LISTING/LISTINGlisting-aggregator/src/api/server.js:366)`

### C. Container runs as non-root

`TEST ID    : INF-CONT-003`
`CATEGORY   : Container Hardening`
`REQUEST    : Inspect Dockerfile and K8s security context`
`EXPECTED   : non-root runtime`
`ACTUAL     : Dockerfile switches to `USER nodejs`; K8s sets `runAsNonRoot: true` and `runAsUser: 1001``
`STATUS     : PASS`
`EVIDENCE   : [Dockerfile](/d:/LISTING/LISTINGlisting-aggregator/Dockerfile:46), [k8s/deployment.yaml](/d:/LISTING/LISTINGlisting-aggregator/k8s/deployment.yaml:28)`

## Not Applicable / Not Fully Verifiable From This Repo

- Native registration/password login/reset flows: primary auth is delegated to Clerk, so many `AUTH-REG-*`, `AUTH-LOG-*`, and `AUTH-RST-*` tests must be run against the live Clerk tenant and frontend flow
- File upload exploit chain: no first-class upload API surface was found in the project routes audited here
- GraphQL tests: no GraphQL server was found in the working tree
- Public TLS posture: requires testing the deployed hostname, not just local `localhost:3000`

## Recommended Remediation Order

1. Remove all committed secrets and rotate them.
2. Eliminate non-user-scoped SQLite read paths from authenticated endpoints.
3. Remove bearer tokens from query strings.
4. Lock CORS to a strict origin allowlist.
5. Stop baking `.env` files into production images.
6. Add revocation-aware session validation for Clerk-backed API access.
7. Add HTTP hardening headers and remove `X-Powered-By`.
8. Reduce unauthenticated health endpoint disclosure.
9. Tighten Postgres TLS verification and Kubernetes privileges.
