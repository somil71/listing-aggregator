#!/usr/bin/env bash
# scripts/restore.sh — Restore SQLite database from a dated backup.
# Usage:
#   bash scripts/restore.sh                        # restore latest backup
#   bash scripts/restore.sh 20260523               # restore specific date
#   bash scripts/restore.sh 20260523 --verify-only # verify without restoring
#
# Cron (test restore weekly at 03:00 Sunday):
#   0 3 * * 0 cd /app && bash scripts/restore.sh --verify-only >> logs/restore.log 2>&1

set -euo pipefail

DB_DEST="data/db/listings.db"
BACKUP_ROOT="backups"
VERIFY_ONLY=0

# Parse arguments
DATE_ARG=""
for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=1 ;;
    [0-9]*) DATE_ARG="$arg" ;;
  esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Find backup ─────────────────────────────────────────────────────────────
if [[ -n "$DATE_ARG" ]]; then
  BACKUP_DIR="${BACKUP_ROOT}/${DATE_ARG}"
else
  BACKUP_DIR=$(ls -d "${BACKUP_ROOT}"/[0-9]* 2>/dev/null | sort | tail -1)
fi

if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  log "❌ No backup found in ${BACKUP_ROOT}/"
  exit 1
fi


BACKUP_FILE="${BACKUP_DIR}/listings.db"
BACKUP_GZ="${BACKUP_DIR}/listings.db.gz"

# Prefer the plain copy; fall back to decompressing the gzip
if [[ -f "$BACKUP_FILE" ]]; then
  SOURCE="$BACKUP_FILE"
elif [[ -f "$BACKUP_GZ" ]]; then
  log "Decompressing ${BACKUP_GZ}..."
  TMPFILE=$(mktemp)
  gunzip -c "$BACKUP_GZ" > "$TMPFILE"
  SOURCE="$TMPFILE"
  trap "rm -f $TMPFILE" EXIT
else
  log "❌ No backup file found in ${BACKUP_DIR}"
  exit 1
fi

log "Backup source : ${SOURCE}"
log "Restore target: ${DB_DEST}"

# ── Verify integrity of source ───────────────────────────────────────────────
if command -v sqlite3 &>/dev/null; then
  INTEGRITY=$(sqlite3 "$SOURCE" "PRAGMA integrity_check;" 2>/dev/null || echo "ERROR")
  if [[ "$INTEGRITY" != "ok" ]]; then
    log "❌ Source integrity check FAILED: ${INTEGRITY}"
    exit 1
  fi

  COUNT=$(sqlite3 "$SOURCE" "SELECT COUNT(*) FROM listings;" 2>/dev/null || echo "ERROR")
  if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    log "✅ Source verified: ${COUNT} listings, integrity ok"
  else
    log "❌ Could not count listings in source"
    exit 1
  fi
else
  log "⚠️  sqlite3 not on PATH — skipping integrity check"
fi

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  log "✅ Verify-only mode — no restore performed"
  exit 0
fi

# ── Stop server if running (systemd / PM2) ───────────────────────────────────
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q 'property-digest'; then
  log "Stopping PM2 process..."
  pm2 stop property-digest
  RESTART_PM2=1
fi

# ── Backup current DB before overwriting ─────────────────────────────────────
if [[ -f "$DB_DEST" ]]; then
  PRE_RESTORE="${DB_DEST}.pre-restore.$(date +%Y%m%d%H%M%S)"
  cp "$DB_DEST" "$PRE_RESTORE"
  log "Current DB backed up to ${PRE_RESTORE}"
fi

# ── Restore ──────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$DB_DEST")"
cp "$SOURCE" "$DB_DEST"
log "✅ Restored to ${DB_DEST}"

# ── Post-restore verification ─────────────────────────────────────────────────
if command -v sqlite3 &>/dev/null; then
  POST_COUNT=$(sqlite3 "$DB_DEST" "SELECT COUNT(*) FROM listings;" 2>/dev/null || echo "0")
  log "Post-restore row count: ${POST_COUNT}"
fi

# ── Restart server if we stopped it ─────────────────────────────────────────
if [[ "${RESTART_PM2:-0}" -eq 1 ]]; then
  pm2 start property-digest
  log "PM2 process restarted"
fi

log "✅ Restore complete from ${BACKUP_DIR}"
