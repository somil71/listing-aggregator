require('dotenv').config();
const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');

// Clerk's public JWKS endpoint — no secret key required, always returns current keys.
// Decoded from publishable key: pk_test_Z2xhZC1qYXktMzEuY2xlcmsuYWNjb3VudHMuZGV2JA → glad-jay-31.clerk.accounts.dev
const JWKS = createRemoteJWKSet(
  new URL('https://glad-jay-31.clerk.accounts.dev/.well-known/jwks.json')
);

// ── Standard middleware — reads Clerk JWT from Authorization header ────────────
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    // Clock-skew tolerance: Clerk dev tokens live only ~60s, and small clock
    // drift between this container and Clerk's issuer was rejecting tokens that
    // were valid per Clerk but appeared a hair past `exp` here ("exp claim
    // timestamp check failed"). 60s absorbs realistic container skew + the
    // refresh boundary. Clerk's own backend SDK applies a tolerance for the
    // same reason.
    const { payload } = await jwtVerify(token, JWKS, { clockTolerance: 60 });
    req.userId = payload.sub;
    next();
  } catch (err) {
    console.error('[auth] verifyToken failed:', err?.message ?? err);
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
};

// ── SSE one-time nonce store ───────────────────────────────────────────────────
// EventSource cannot set custom headers, so we use a short-lived one-time nonce
// instead of passing the full Clerk JWT in the URL (which would appear in server
// logs, browser history, and Referer headers).
//
// Flow:
//   1. Client calls POST /api/v1/whatsapp/sse-token (Bearer auth) → gets nonce
//   2. Client opens EventSource with ?token=<nonce>
//   3. authenticateSSE validates the nonce (single-use, 30 s TTL) and deletes it
//
// Storage strategy (distributed-safe):
//   - Primary: Redis with `nonce:<value>` key and 60s EX. Atomic GETDEL on
//     validation ensures the nonce can only be consumed once even when two
//     server instances race.
//   - Fallback: in-process Map when Redis isn't configured (single-instance
//     deployments). The Map is bounded by its own setInterval cleanup.
let cacheService = null;
try { cacheService = require('../services/cacheService'); } catch { cacheService = null; }

const _sseNoncesMem = new Map(); // fallback only — used when Redis is offline

// Purge expired in-memory nonces every 60s
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of _sseNoncesMem) {
    if (now > entry.expiresAt) _sseNoncesMem.delete(nonce);
  }
}, 60_000).unref();

const NONCE_TTL_SEC = 60; // 60s window between issue and EventSource open

async function createSSENonce(userId) {
  const nonce = crypto.randomBytes(20).toString('hex'); // 40 hex chars
  const key = `sse-nonce:${nonce}`;

  if (cacheService && cacheService._redisReady) {
    await cacheService._redis.set(key, userId, 'EX', NONCE_TTL_SEC);
  } else {
    _sseNoncesMem.set(nonce, { userId, expiresAt: Date.now() + NONCE_TTL_SEC * 1000 });
  }
  return nonce;
}

// SSE middleware — validates a one-time nonce (not a JWT)
const authenticateSSE = async (req, res, next) => {
  const nonce = req.query.token;
  if (!nonce || typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 64) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const key = `sse-nonce:${nonce}`;

  let userId = null;
  if (cacheService && cacheService._redisReady) {
    try {
      userId = await cacheService._redis.call('GETDEL', key).catch(async () => {
        const v = await cacheService._redis.get(key);
        if (v) await cacheService._redis.del(key);
        return v;
      });
    } catch (err) {
      // Redis blip — fall through to in-memory check
    }
  }

  if (!userId) {
    const entry = _sseNoncesMem.get(nonce);
    if (entry) {
      _sseNoncesMem.delete(nonce); // single-use
      if (Date.now() > entry.expiresAt) {
        return res.status(401).json({ success: false, error: 'Token expired' });
      }
      userId = entry.userId;
    }
  }

  if (!userId) return res.status(401).json({ success: false, error: 'Invalid or expired token' });

  req.userId = userId;
  next();
};

// clerk client kept for any management API calls elsewhere in the codebase
const { createClerkClient } = require('@clerk/backend');
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

module.exports = { clerk, authenticate, authenticateSSE, createSSENonce };
