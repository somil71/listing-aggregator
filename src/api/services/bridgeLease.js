// Distributed bridge ownership lease — Redis-backed.
//
// In a multi-instance deployment, when a user calls /initiate-qr we need a
// single, deterministic answer to "which instance owns this user's bridge
// subprocess?" Without coordination, instance A and instance B could both
// spawn Chromium for the same user, creating duplicate sessions and racing
// on the auth directory.
//
// Strategy:
//   - When an instance spawns a bridge for userId, it takes a 60s lease in
//     Redis: SET bridge-lease:<userId> <instanceId> NX EX 60
//   - The instance refreshes the lease every 20s while the bridge is alive
//   - Other instances see the existing lease and route /initiate-qr to a
//     stub response asking the client to retry after the lease expires (or
//     they can be made to forward the request to the owning instance via a
//     sidecar HTTP call — out of scope for this layer)
//
// This module is a building block — wiring it into whatsappService is the
// next step (see TODO at bottom).
//
// In single-instance deployments (or when Redis is offline) the lease
// degrades to a local Map so existing behaviour is preserved.

const crypto = require('crypto');

let cacheService = null;
try { cacheService = require('./cacheService'); } catch { cacheService = null; }

// Stable per-process instance identifier. In Docker this is the container
// ID (HOSTNAME); in bare-metal we mint one from the PID + crypto bytes.
const INSTANCE_ID =
  process.env.HOSTNAME ||
  `${require('os').hostname()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

const LEASE_TTL_SEC      = 60;
const LEASE_REFRESH_MS   = 20_000;

const _memLeases = new Map();   // userId → { ownerId, expiresAt }
const _refreshTimers = new Map();

// Try to acquire the lease. Returns:
//   { acquired: true, ownerId }  — we own it
//   { acquired: false, ownerId } — someone else owns it
async function acquire(userId) {
  const key = `bridge-lease:${userId}`;

  if (cacheService?._redisReady) {
    try {
      // SET ... NX EX 60 — atomic check-and-set
      const ok = await cacheService._redis.set(key, INSTANCE_ID, 'EX', LEASE_TTL_SEC, 'NX');
      if (ok === 'OK') return { acquired: true, ownerId: INSTANCE_ID };
      const owner = await cacheService._redis.get(key);
      return { acquired: false, ownerId: owner };
    } catch (err) {
      // Redis blip — fall through to in-memory
    }
  }

  // In-memory fallback (single-instance only)
  const now = Date.now();
  const existing = _memLeases.get(userId);
  if (existing && now < existing.expiresAt) {
    return { acquired: existing.ownerId === INSTANCE_ID, ownerId: existing.ownerId };
  }
  _memLeases.set(userId, { ownerId: INSTANCE_ID, expiresAt: now + LEASE_TTL_SEC * 1000 });
  return { acquired: true, ownerId: INSTANCE_ID };
}

// Refresh the lease — call periodically while the bridge is alive.
// Only refreshes if we still hold it (no surprise takeovers).
async function refresh(userId) {
  const key = `bridge-lease:${userId}`;

  if (cacheService?._redisReady) {
    try {
      // Lua script for atomic "extend if owned"
      const script = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('EXPIRE', KEYS[1], ARGV[2])
        else
          return 0
        end`;
      const res = await cacheService._redis.eval(script, 1, key, INSTANCE_ID, LEASE_TTL_SEC);
      return res === 1;
    } catch (_) { /* fall through */ }
  }

  const entry = _memLeases.get(userId);
  if (entry?.ownerId === INSTANCE_ID) {
    entry.expiresAt = Date.now() + LEASE_TTL_SEC * 1000;
    return true;
  }
  return false;
}

// Release the lease atomically — only if we still own it (Lua again).
async function release(userId) {
  const key = `bridge-lease:${userId}`;

  if (cacheService?._redisReady) {
    try {
      const script = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        else
          return 0
        end`;
      await cacheService._redis.eval(script, 1, key, INSTANCE_ID);
    } catch (_) {}
  }

  const entry = _memLeases.get(userId);
  if (entry?.ownerId === INSTANCE_ID) _memLeases.delete(userId);
}

// Start a background refresher for a userId. Returns a cancel fn.
function startRefresh(userId) {
  const timer = setInterval(() => {
    refresh(userId).catch(() => {});
  }, LEASE_REFRESH_MS);
  timer.unref?.();
  _refreshTimers.set(userId, timer);
  return () => {
    clearInterval(timer);
    _refreshTimers.delete(userId);
  };
}

function stopRefresh(userId) {
  const t = _refreshTimers.get(userId);
  if (t) clearInterval(t);
  _refreshTimers.delete(userId);
}

module.exports = {
  acquire,
  refresh,
  release,
  startRefresh,
  stopRefresh,
  INSTANCE_ID,
  LEASE_TTL_SEC,
};

// TODO (next step toward multi-instance):
//   - In whatsappService.initiateQR, call acquire() before spawning the child.
//     If !acquired, return { status: 'owned_by_other', ownerId } and let the
//     client either retry or route to the owning instance.
//   - On child exit, call release(userId).
//   - On periodic health tick, call refresh(userId).
//   - On SSE registration, use the lease ownerId to confirm "we are the
//     instance that should serve this stream" — if not, return 421 Misdirected
//     Request and let the load balancer's sticky-session cookie re-route.
