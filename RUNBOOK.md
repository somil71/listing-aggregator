# Property Digest — Operations Runbook

For on-call. Each section is a self-contained playbook.

## 1. Quick reference

| What | Where |
|------|-------|
| Health endpoint | `GET /health` → 200 OK |
| Metrics endpoint | `GET /api/v1/metrics` (token-gated via `X-Metrics-Token`) |
| Logs | `logs/app.log`, `logs/error.log` (or stdout in container) |
| Traces | OTLP collector at `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Migration runner | `npm run migrate:pg` |
| Backup script | `npm run backup` |

## 2. Symptom → first action

### "QR modal stuck on Opening secure stream…"
- Check `pd_sse_failures_total` metric — has it spiked?
- Check `bridge-lease:*` keys in Redis — is another instance holding the lease?
- Confirm the SSE nonce endpoint returns 200: `curl -X POST -H "Authorization: Bearer <jwt>" /api/v1/whatsapp/sse-token`

### "WhatsApp says connected but no listings appearing"
- Check `pd_queue_depth{queue="parse:listings"}` — is the queue draining?
- Check `pd_listings_created_total` — is it incrementing?
- Check parse worker logs: `tail logs/parseWorker.log | grep failed`
- Inspect dead-lettered jobs:
  ```sql
  SELECT raw_message_id, attempts, dead_reason, dead_at
    FROM parse_jobs WHERE status = 'dead'
    ORDER BY dead_at DESC LIMIT 20;
  ```

### "Server is 503-ing requests"
- Check circuit-breaker state via `pd_circuit_breaker_open{name="..."}`.
- If `name="postgres"` is 1 — DB is down. See section 3.
- If `name="whatsapp"` is 1 — bridge subprocess failures. Check `pd_bridge_reconnects_total`.
- If `name="llm"` is 1 — Groq/Gemini API issues. `/summary` will fall back to template. No action needed unless prolonged.

### "Latency p95 > 2s"
- Check `pd_pg_pool_saturation` — at 1.0 means pool exhausted.
  - Most common cause: a hung outbound fetch (Groq/Gemini) that escaped the AbortController.
  - Recovery: `kubectl rollout restart deployment/property-digest-app` or `docker compose restart app`.
- Check OTel traces for the slowest 1% of spans.

## 3. Postgres outage

1. Verify connectivity from the app pod:
   ```bash
   kubectl exec -it deploy/property-digest -- node -e \
     "require('./src/db/postgres/pool').dbGet('SELECT 1').then(console.log).catch(console.error)"
   ```
2. If unreachable:
   - Check Neon dashboard for instance status.
   - The app will continue to serve `/health` 503 and reads with 500. The
     `postgresBreaker` opens after 3 fails; new reads short-circuit.
3. When Neon is back:
   - The breaker auto-probes after 10s and recovers.
   - Cache (`cacheService`) continues serving stale reads if Redis is healthy.

## 4. Redis outage

The app degrades gracefully:
- `cacheService` falls back to in-memory cache (per-instance).
- `bridgeLease` falls back to in-memory (single-instance only).
- `bridgeBus` falls back to local EventEmitter (single-instance only).
- SSE nonce store falls back to in-memory Map.

**Recovery is automatic** — re-enable Redis and the next ready event flips
all subsystems back to distributed mode. No manual intervention required.

## 5. Bridge process leak / orphan Chromium

Symptoms: host CPU/memory climbing, `pd_whatsapp_clients_active` > expected.

```bash
# Check active bridge subprocesses
ps auxf | grep whatsapp-qr-bridge

# Check leases in Redis
redis-cli -a $REDIS_PASSWORD KEYS 'bridge-lease:*'

# Force-kill orphans (Linux/macOS)
pkill -f whatsapp-qr-bridge
```

The next `/initiate-qr` call from a user will respawn a clean bridge for them.

## 6. Dead-letter queue drain

Inspect & manually re-queue failed parse jobs:

```sql
-- See what's dead and why
SELECT raw_message_id, attempts, dead_reason
  FROM parse_jobs WHERE status = 'dead'
  ORDER BY dead_at DESC LIMIT 50;

-- Mark for retry
UPDATE parse_jobs SET status = 'pending', attempts = 0, dead_at = NULL
  WHERE raw_message_id IN (...);

-- Then re-enqueue from the raw_messages source:
INSERT INTO parse_jobs (raw_message_id, status, attempts)
SELECT id, 'pending', 0 FROM raw_messages
 WHERE id NOT IN (SELECT raw_message_id FROM listings)
   AND created_at > NOW() - INTERVAL '7 days'
ON CONFLICT (raw_message_id) DO UPDATE SET status = 'pending', attempts = 0;
```

Then bounce the worker so it picks up the queue:
```bash
docker compose restart worker
```

## 7. Deployment

### Rolling update (zero downtime)

The app is stateless except for bridge subprocesses owned via Redis lease.
A rolling restart will:
1. Stop accepting new connections on old pods (`server.close()`).
2. Force-kill local bridges (they will be re-spawned on the new pod when
   the user reconnects).
3. Drain PG pool.
4. Exit cleanly within the 10s grace window.

Kubernetes does this automatically with the default `rollingUpdate` strategy.
Docker Compose:
```bash
docker compose up -d --no-deps --build app worker
```

### Rollback

```bash
# Kubernetes
kubectl rollout undo deployment/property-digest

# Docker Compose
git checkout <previous-tag> && docker compose up -d --build
```

Database migrations are forward-only. If a rollback requires schema reversal,
write an explicit down-migration and apply it before redeploying.

## 8. Backup & restore

- **Postgres**: Neon manages PITR (point-in-time recovery) up to 7d on free
  tier, 30d on paid. Manual snapshots via `scripts/backup.sh`.
- **Bridge state** (auth dirs, WhatsApp sessions): `data/wwebjs-auth/`.
  Backed up by `scripts/backup.sh` if you want users to keep sessions
  through full DR. Otherwise users re-scan QR on disaster recovery.
- **Restore**: `bash scripts/restore.sh` → see comments in script.

## 9. Secrets

Rotation procedure:
1. Generate new value (e.g. `openssl rand -hex 32` for HMAC, regenerate in
   Clerk/Groq/Gemini consoles for API keys).
2. Update secret in your secret manager (Vault/Doppler/k8s Secret/etc.).
3. Roll the deployment so pods pick up the new env.
4. After 24h, revoke the old secret in the upstream provider.

The Clerk JWT public key is embedded in `auth.js` for offline verification.
On Clerk's signing-key rotation, fetch the new key from
`https://<your-instance>.clerk.accounts.dev/.well-known/jwks.json` and
update both the embedded constant AND `CLERK_JWT_KEY` env var.

## 10. Common metrics queries

```promql
# p95 latency over last 5m
histogram_quantile(0.95, sum(rate(pd_http_request_duration_seconds_bucket[5m])) by (le, route))

# Error rate
sum(rate(pd_http_requests_total{status_code=~"5.."}[5m])) / sum(rate(pd_http_requests_total[5m]))

# Cache hit rate
sum(rate(pd_cache_hits_total[5m])) / (sum(rate(pd_cache_hits_total[5m])) + sum(rate(pd_cache_misses_total[5m])))

# Active bridges
pd_whatsapp_clients_active

# Queue lag
pd_queue_depth

# Bridge reconnect rate
rate(pd_bridge_reconnects_total[5m])
```

## 11. Recommended alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| API down | up{job="property-digest"} == 0 for 1m | page |
| High 5xx rate | error_rate > 0.05 for 5m | page |
| PG pool saturated | pd_pg_pool_saturation > 0.9 for 5m | page |
| Circuit breaker open | pd_circuit_breaker_open > 0 for 5m | warn |
| Queue lag growing | pd_queue_depth > 1000 for 10m | warn |
| Bridge reconnect storm | rate > 0.1/s for 5m | warn |
| Disk full risk | container_fs_usage_bytes > 0.85 × limit | warn |
