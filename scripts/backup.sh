#!/usr/bin/env bash
# scripts/backup.sh — Daily SQLite backup with verification.
# Usage: bash scripts/backup.sh
# Cron (daily at 02:00): 0 2 * * * cd /app && bash scripts/backup.sh >> logs/backup.log 2>&1

set -euo pipefail

DB_SOURCE="data/db/listings.db"
BACKUP_ROOT="backups"
TODAY=$(date +%Y%m%d)
BACKUP_DIR="${BACKUP_ROOT}/${TODAY}"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..."

# 1. Raw copy
cp "$DB_SOURCE" "${BACKUP_DIR}/listings.db"

# 2. Compressed copy
gzip -c "$DB_SOURCE" > "${BACKUP_DIR}/listings.db.gz"

# 3. Integrity check
LISTING_COUNT=$(sqlite3 "${BACKUP_DIR}/listings.db" "SELECT COUNT(*) FROM listings;" 2>/dev/null || echo "ERROR")

if [[ "$LISTING_COUNT" =~ ^[0-9]+$ ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Backup verified: ${LISTING_COUNT} listings in ${BACKUP_DIR}"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Backup verification FAILED"
  exit 1
fi

# 4. Optional: upload to S3 (uncomment and set bucket name)
# if command -v aws &>/dev/null && [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
#   aws s3 cp "${BACKUP_DIR}/listings.db.gz" "s3://${BACKUP_S3_BUCKET}/${TODAY}.db.gz"
#   echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploaded to s3://${BACKUP_S3_BUCKET}/${TODAY}.db.gz"
# fi

# 5. Remove backups older than 30 days
find "$BACKUP_ROOT" -name "listings.db*" -mtime +30 -delete 2>/dev/null || true
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaned up backups older than 30 days"
