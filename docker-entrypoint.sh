#!/bin/sh
# Railway volumes are mounted root-owned. The container starts as root so this
# script can hand the mount to the app user, then it drops privileges — the
# app itself never runs as root.
set -e

if [ "$(id -u)" = "0" ]; then
  # Top-level only: children created afterwards by nodejs inherit ownership.
  chown nodejs:nodejs /app/data 2>/dev/null || true
  # Fix any first-level entries left root-owned by a previous boot or the mount.
  find /app/data -maxdepth 1 ! -user nodejs -exec chown nodejs:nodejs {} + 2>/dev/null || true
  exec su-exec nodejs "$@"
fi

exec "$@"
