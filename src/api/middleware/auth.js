require('dotenv').config();
const crypto = require('crypto');
// In @clerk/backend v3, verifyToken is a top-level export — NOT a method on
// the object returned by createClerkClient().  createClerkClient() is still
// used for the management API (users, sessions, etc.).
const { createClerkClient, verifyToken } = require('@clerk/backend');

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Clerk v3 enforces authorizedParties when the JWT contains an `azp` claim.
// The frontend stamps azp = the page's origin, so whitelist every origin that
// legitimately loads the app.  Override via CLERK_AUTHORIZED_PARTIES (comma-
// separated) in production.
const _rawParties = process.env.CLERK_AUTHORIZED_PARTIES || '';
const authorizedParties = _rawParties
  ? _rawParties.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'http://localhost:3000',   // Express server (production build)
      'http://localhost:5173',   // Vite dev server
      'http://localhost:4173',   // Vite preview
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ];

// RSA public key for this Clerk instance (kid: ins_3EDGPfw02KmMVzHEDBcIzjnDhYn).
// This is a PUBLIC key — it is NOT a secret and is safe to embed here.
// Using it directly avoids any outbound JWKS network fetch, which is required
// when running inside a sandboxed environment (preview tool, restricted VMs).
// To regenerate: fetch https://glad-jay-31.clerk.accounts.dev/.well-known/jwks.json
// and convert the first key via crypto.createPublicKey({key,format:'jwk'}).export({type:'spki',format:'pem'})
// Also set/update CLERK_JWT_KEY in .env so Docker/production uses it too.
const CLERK_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu6Yi3C+j80tg/zU1Pn+8
qQ5Kz7Yuyk9elY0ccWo1hAR20n+ATADgfd+ffiQqJxLM2rPdqggtnuSgDQpnzUyr
fJQ5zmIitkny6Ms60uD8f5ZlQvC34Vang6KeuvJm0xutPwR7kS0yJ9r2zmVBLB4L
RDBxj6D0iqVUV6gTVm8tE2GTENSdJameowyqP3Lo0a9jesC0b3W0c4nfVkNVeEjL
9jyxfJuIur3vK+PDSeAjPTri9syeclW6gWa4sBmoFMaKe5SNtwbBOVw7l+TVtR+a
hOd0ZXdReBKqux96cPpowI0v21WY9vU8rW7j18Pyjn7PgK4/w6Q2Gy2SPZOKNiNx
SwIDAQAB
-----END PUBLIC KEY-----`;

// Prefer the env-var override (useful for key rotation without redeployment),
// then fall back to the embedded key above, then fall back to secretKey (JWKS fetch).
const _jwtKey = process.env.CLERK_JWT_KEY || CLERK_RSA_PUBLIC_KEY;

const _verifyOpts = {
  jwtKey: _jwtKey,
  authorizedParties,
};

// ── Standard middleware — reads Clerk JWT from Authorization header ────────────
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const payload = await verifyToken(token, _verifyOpts);
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
//
// In multi-instance (Docker --scale, K8s replicas) the Redis path is required:
// a nonce created by instance A must be validated by instance B.
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
    // Redis: 60s expiry guarantees automatic cleanup
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
      // GETDEL is atomic — read-and-consume in one round trip.  Falls back to
      // GET+DEL for older Redis versions that don't support GETDEL.
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

module.exports = { clerk, authenticate, authenticateSSE, createSSENonce };
