# Security Audit — 2026-05-27

Date: 2026-05-27
Auditor: Codex
Workspace: `d:\LISTING\LISTINGlisting-aggregator`
Mode: White-box with limited local runtime validation

## Scope

Covered in this pass:

- Backend auth middleware and API authorization
- Session/token handling as implemented in this repo
- CORS and HTTP response hardening
- Secret exposure in source-controlled files
- Multi-tenant data isolation in listing/search/agent/group/digest endpoints
- Dependency vulnerability snapshot via `npm audit --omit=dev --json`

Not fully covered in this pass:

- Clerk-hosted registration/login/password-reset UX flows
- Browser-side MITM interception with Burp/ZAP
- TLS configuration of any public production hostname
- End-to-end two-user runtime IDOR replay with valid Clerk tokens
- File upload security (no upload surface found in repo)

## Executive Summary

The application has several real security issues, centered on authorization scope and token handling:

1. Authenticated users can query global SQLite-backed data through multiple endpoints that are not user-scoped.
2. The WhatsApp SSE flow places bearer tokens in the URL query string.
3. CORS reflects arbitrary origins while also allowing credentials.
4. Secrets are committed in tracked env files, including a server-side Clerk secret inside the frontend folder.
5. The API omits standard hardening headers and still exposes `X-Powered-By`.
6. JWT verification is stateless/offline, so logout and session revocation are not enforced by the backend.

## Findings

### 1. Critical — Horizontal data exposure on authenticated endpoints

`TEST ID    : SESS-ISO-03 / BL-HORIZ-04`
`CATEGORY   : Session Isolation / Horizontal Privilege Escalation`
`REQUEST    : Any authenticated request to GET /api/v1/search, GET /api/v1/digests/:date, GET /api/agents, GET /api/groups`
`EXPECTED   : Only the authenticated user's data is returned`
`ACTUAL     : These handlers query shared SQLite tables without any user filter`
`STATUS     : VULN`
`SEVERITY   : CRITICAL`
`EVIDENCE   : src/api/server.js lines 389-447, 455-461, 465-477, 481-492`
`REMEDIATION: Migrate these endpoints to the Postgres user-scoped model already used by /api/listings/today and /api/listings/:id, or add strict user ownership columns and filters before any response is returned`

Why this matters:

- `/api/v1/search` reads from global `listings` via SQLite and caches by query only.
- `/api/v1/digests/:date` reads a global digest row by date.
- `/api/agents` and `/api/groups` aggregate across all listings.
- A valid user token is enough to access shared data that is not tied to that user.

### 2. High — Bearer token exposed in URL query string for SSE

`TEST ID    : INTR-EXP-05 / SESS-TOK-04`
`CATEGORY   : Sensitive Data Exposure / Session Handling`
`REQUEST    : GET /api/v1/whatsapp/qr-stream?token=<bearer>`
`EXPECTED   : Auth tokens should not appear in URLs`
`ACTUAL     : SSE auth requires a `token` query parameter; frontend constructs the URL with the Clerk bearer token`
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : src/api/middleware/auth.js lines 64-75, src/api/routes/whatsapp.js lines 9-22, dashboard/src/hooks/useWhatsAppApi.ts lines 65-69`
`REMEDIATION: Replace query-string auth with an HttpOnly session cookie for the SSE route, or mint a short-lived one-time stream ticket that is not the primary bearer token`

Why this matters:

- URLs leak into browser history, debugging tools, reverse proxies, and third-party monitoring more easily than headers.
- Even though this server logs `req.path` instead of `req.originalUrl`, intermediaries may still capture the full URL.

### 3. High — Arbitrary-origin CORS reflection with credentials enabled

`TEST ID    : CORS-01 / CORS-02 / CORS-03`
`CATEGORY   : CORS`
`REQUEST    : OPTIONS /api/listings/today with `Origin: https://evil.com``
`EXPECTED   : Unknown origins should not be allowed on authenticated endpoints`
`ACTUAL     : Server returned `Access-Control-Allow-Origin: https://evil.com` and `Access-Control-Allow-Credentials: true``
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : src/api/server.js line 103; runtime capture from `curl -i -X OPTIONS -H "Origin: https://evil.com" -H "Access-Control-Request-Method: GET" http://localhost:3000/api/listings/today` returned `204` with reflected origin and credential allowance`
`REMEDIATION: Replace `origin: true` with a strict allowlist of trusted frontend origins and deny all others`

### 4. High — Backend does not enforce logout/session revocation

`TEST ID    : SESS-LIF-01 / SESS-LIF-05 / SESS-LIF-06 / API-AUTH-04`
`CATEGORY   : Session Lifecycle`
`REQUEST    : Replay a previously valid Clerk JWT after logout, password change, or user deletion`
`EXPECTED   : Server-side session invalidation or live session verification should reject replay`
`ACTUAL     : Middleware performs offline signature validation only and never checks live Clerk session status`
`STATUS     : VULN`
`SEVERITY   : HIGH`
`EVIDENCE   : src/api/middleware/auth.js lines 43-60`
`REMEDIATION: Validate the session against Clerk on sensitive requests, or use a revocation-aware verification path instead of pure offline public-key validation for long-lived bearer tokens`

Note:

- The code verifies signature and claims, which is good for integrity.
- The gap is revocation awareness, not JWT parsing correctness.

### 5. Critical — Real secrets committed in tracked files

`TEST ID    : ENC-DAT-03 / INTR-EXP-03`
`CATEGORY   : Secrets Management`
`REQUEST    : Inspect tracked env/config files in repository`
`EXPECTED   : Secrets should come from deployment environment, not tracked files`
`ACTUAL     : `.env` contains live service credentials; `dashboard/.env.local` contains `CLERK_SECRET_KEY``
`STATUS     : VULN`
`SEVERITY   : CRITICAL`
`EVIDENCE   : .env, dashboard/.env.local`
`REMEDIATION: Rotate exposed credentials immediately, remove secrets from tracked files, add `.env.example`, and ensure frontend directories never contain server secrets`

### 6. Medium — Missing HTTP hardening headers and framework fingerprint leakage

`TEST ID    : API-HDR-01 to API-HDR-06`
`CATEGORY   : HTTP Security Headers`
`REQUEST    : GET /health`
`EXPECTED   : CSP, HSTS, X-Frame-Options, X-Content-Type-Options present; `X-Powered-By` absent`
`ACTUAL     : Runtime response included `X-Powered-By: Express`; no CSP, HSTS, X-Frame-Options, or `X-Content-Type-Options: nosniff` were observed`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : src/api/server.js has no helmet/header middleware; `curl -i http://localhost:3000/health` showed `X-Powered-By: Express` and omitted the standard hardening headers`
`REMEDIATION: Disable `X-Powered-By`, add explicit security headers or `helmet`, and set HSTS only on HTTPS deployments`

### 7. Medium — Error responses leak internal implementation details

`TEST ID    : API-HDR-07 / INF-ERR-02`
`CATEGORY   : Error Handling / Information Disclosure`
`REQUEST    : Trigger backend failures on protected routes`
`EXPECTED   : Generic client-safe error message without internal details`
`ACTUAL     : Multiple handlers return `error.message` directly in JSON responses`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : src/api/server.js lines 292-295, 360-362, 383-384, 448-450; src/api/routes/whatsapp.js lines 39, 49, 59, 73, 83, 93, 149; logs/error.log shows raw SQL errors such as `column l.parking does not exist``
`REMEDIATION: Return stable generic messages to clients, keep detailed stack/SQL data in server logs only, and standardize error envelopes`

### 8. Medium — TLS client verification is explicitly weakened for Postgres

`TEST ID    : INTR-TLS-04`
`CATEGORY   : Transport Security`
`REQUEST    : Inspect database TLS client configuration`
`EXPECTED   : Certificate validation should remain enabled unless there is a documented pinning/CA reason`
`ACTUAL     : Postgres pool uses `ssl: { rejectUnauthorized: false }``
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : src/db/postgres/pool.js lines 9-15`
`REMEDIATION: Use the provider's CA bundle or verified TLS configuration instead of disabling certificate validation`

### 9. Medium — Production dependency snapshot contains one high and multiple moderate vulnerabilities

`TEST ID    : INF-DEP-01`
`CATEGORY   : Dependency Security`
`REQUEST    : `cmd /c npm.cmd audit --omit=dev --json``
`EXPECTED   : No high/critical production vulnerabilities`
`ACTUAL     : `tmp` reported as `high`; multiple moderate issues also reported via `@wppconnect-team/wppconnect` transitive dependencies`
`STATUS     : VULN`
`SEVERITY   : MEDIUM`
`EVIDENCE   : npm audit result on 2026-05-27`
`REMEDIATION: Upgrade or replace affected packages, especially the chain anchored by `@wppconnect-team/wppconnect`, and verify whether `tmp` is reachable in production code paths`

## Verified Passes

### A. Unauthenticated protected endpoints reject missing/invalid tokens

`TEST ID    : API-AUTH-01 / API-AUTH-02`
`CATEGORY   : Authentication Enforcement`
`REQUEST    : GET /api/listings/today with no token and with `Bearer invalid_token_here``
`EXPECTED   : 401`
`ACTUAL     : 401 observed`
`STATUS     : PASS`
`EVIDENCE   : tests/security.js intent, local logs at 2026-05-27 20:26, and live request captures`

### B. Unknown `/api` routes return a generic JSON 404

`TEST ID    : INF-ERR-01`
`CATEGORY   : Error Handling`
`REQUEST    : GET /api/does-not-exist`
`EXPECTED   : Generic 404 without stack trace`
`ACTUAL     : `{"success":false,"error":"Endpoint not found"}``
`STATUS     : PASS`
`EVIDENCE   : src/api/server.js lines 495-498 and live `curl -i` response`

### C. Root dotfile request is not served

`TEST ID    : INTR-EXP-09 / INF-DEP-02`
`CATEGORY   : Sensitive File Exposure`
`REQUEST    : GET /.env`
`EXPECTED   : 403 or 404`
`ACTUAL     : 404 observed`
`STATUS     : PASS`
`EVIDENCE   : src/api/server.js lines 500-503 and live request capture`

## Skipped / Delegated

These checklist items are not fully testable from this repo alone and should be audited separately against the live Clerk tenant and public deployment:

- `AUTH-REG-*`, `AUTH-LOG-*`, `AUTH-RST-*`
- Cookie-specific checks such as `SESS-TOK-01` through `SESS-TOK-03` when using Clerk-hosted auth
- Public-domain TLS tests `INTR-TLS-*`
- Browser proxy interception tests `INTR-MITM-*`
- Full two-user live IDOR replay with real tokens
- CSRF PoC validation if the deployment continues to use bearer tokens instead of cookies

## Recommended Remediation Order

1. Rotate all exposed secrets and purge them from version control.
2. Eliminate global SQLite read paths from authenticated endpoints.
3. Remove bearer tokens from SSE URLs.
4. Replace permissive CORS reflection with a strict origin allowlist.
5. Add revocation-aware session validation for Clerk-backed API access.
6. Add standard HTTP security headers and disable `X-Powered-By`.
7. Stop returning raw internal error messages to clients.
8. Fix dependency findings and tighten Postgres TLS verification.
