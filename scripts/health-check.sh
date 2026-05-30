#!/usr/bin/env bash
# scripts/health-check.sh — Run the pipeline health snapshot and alert on trouble.
#
# Runs `node src/ops/health.js`, tees the full output to a dated log (history),
# and — only when health.js exits non-zero (STATUS: WARN, or a fatal) — posts the
# captured output to an alert webhook so a human notices without reading logs.
#
# This is the unattended counterpart to running health.js by hand: the WARNs
# health.js already raises (ingestion stalled, parse backlog, dead-letters,
# coverage drop, NEW hallucination class, rising user-flag rate) become a push
# alert instead of a line nobody sees.
#
# Usage:        bash scripts/health-check.sh
# Cron (daily 09:00, Linux/Fly):
#   0 9 * * * cd /app && bash scripts/health-check.sh >> logs/health-cron.log 2>&1
# (See bottom of this file for systemd timer + Windows Task Scheduler.)
#
# Env:
#   HEALTH_ALERT_WEBHOOK  Slack/Discord/generic incoming-webhook URL. Receives a
#                         JSON {"text": "..."} POST on non-zero exit. If unset,
#                         the script still logs + exits non-zero (cron mail can
#                         catch it) but sends no webhook.
#   HEALTH_ALERT_LABEL    Optional prefix for the alert (e.g. "prod", "staging").

set -uo pipefail   # NOTE: no -e — we WANT to capture health.js's non-zero exit.

cd "$(dirname "$0")/.." || exit 2

# The webhook lives in .env (loaded by node, NOT by this shell). A bare cron
# line won't have it in the environment, so pull it from .env when it isn't
# already exported. This is what makes `cd /app && bash scripts/health-check.sh`
# work unattended without a wrapper that sources .env first.
if [[ -z "${HEALTH_ALERT_WEBHOOK:-}" && -f .env ]]; then
  _hw="$(grep -E '^HEALTH_ALERT_WEBHOOK=' .env | tail -1 | cut -d= -f2-)"
  [[ -n "$_hw" ]] && export HEALTH_ALERT_WEBHOOK="$_hw"
fi

LABEL="${HEALTH_ALERT_LABEL:-listings}"
LOG_DIR="logs"
LOG_FILE="${LOG_DIR}/health-$(date +%Y%m%d).log"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"

mkdir -p "$LOG_DIR"

# Run the snapshot, capture output AND preserve the real exit code (tee would
# otherwise mask it with its own).
OUTPUT="$(node src/ops/health.js 2>&1)"
CODE=$?

# History: every run appended, pass or fail.
{
  echo "===== ${STAMP} (exit ${CODE}) ====="
  echo "$OUTPUT"
  echo ""
} >> "$LOG_FILE"

# Also echo to stdout so `>> logs/health-cron.log` (or cron mail) sees it.
echo "[${STAMP}] health.js exit ${CODE}"
echo "$OUTPUT"

# Healthy → done.
if [[ "$CODE" -eq 0 ]]; then
  exit 0
fi

# Unhealthy → alert. Pull just the human-relevant lines (STATUS + the ⚠ bullets)
# so the webhook payload is a tight summary, not the whole snapshot.
SUMMARY="$(printf '%s\n' "$OUTPUT" | grep -E '^(STATUS:|  ⚠|\[health\] fatal)' || true)"
[[ -z "$SUMMARY" ]] && SUMMARY="$OUTPUT"

if [[ -n "${HEALTH_ALERT_WEBHOOK:-}" ]]; then
  # Build the message, then JSON-escape it with node (handles quotes/newlines
  # safely — no fragile sed escaping).
  MESSAGE="[${LABEL}] pipeline health WARN (exit ${CODE}) @ ${STAMP}"$'\n'"${SUMMARY}"
  PAYLOAD="$(MSG="$MESSAGE" node -e 'process.stdout.write(JSON.stringify({text: process.env.MSG}))')"
  HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d "$PAYLOAD" "$HEALTH_ALERT_WEBHOOK" 2>>"$LOG_FILE" || echo "curl-failed")"
  echo "[${STAMP}] alert webhook → HTTP ${HTTP}"
else
  echo "[${STAMP}] HEALTH_ALERT_WEBHOOK unset — logged only, no webhook sent"
fi

exit "$CODE"

# ─────────────────────────────────────────────────────────────────────────────
# Scheduling reference
#
# Linux cron (crontab -e) — daily 09:00, log appended:
#   0 9 * * * cd /app && bash scripts/health-check.sh >> logs/health-cron.log 2>&1
#
# systemd timer (Fly.io / Linux host):
#   /etc/systemd/system/listings-health.service
#     [Unit]
#     Description=Listings pipeline health check
#     [Service]
#     Type=oneshot
#     WorkingDirectory=/app
#     EnvironmentFile=/app/.env
#     ExecStart=/usr/bin/bash scripts/health-check.sh
#   /etc/systemd/system/listings-health.timer
#     [Unit]
#     Description=Run listings health check daily
#     [Timer]
#     OnCalendar=*-*-* 09:00:00
#     Persistent=true
#     [Install]
#     WantedBy=timers.target
#   Then: systemctl enable --now listings-health.timer
#
# Windows Task Scheduler (dev box) — run via Git Bash daily at 09:00:
#   schtasks /Create /TN "ListingsHealth" /SC DAILY /ST 09:00 ^
#     /TR "\"C:\Program Files\Git\bin\bash.exe\" -lc \"cd /d/LISTING/LISTINGlisting-aggregator && bash scripts/health-check.sh\""
# ─────────────────────────────────────────────────────────────────────────────
