// Redis-backed pub/sub + stream layer for bridge ↔ server communication.
//
// Replaces the filesystem-based IPC (.jsonl tail + .cmd files) so that:
//
//   1. Any server instance can serve any user's SSE stream (bridge events
//      are pub/sub, not tied to one node's filesystem).
//   2. Commands (disconnect, get_groups, rescrape) can be sent from any
//      instance to the bridge owner via a per-user Redis list.
//   3. Bridge events are HMAC-signed so a compromised filesystem can't
//      inject fake events.
//
// Channels:
//   pubsub  bridge:events:<userId>            — fan-out of bridge events to all
//                                                connected SSE listeners
//   list    bridge:cmd:<userId>               — commands consumed by the bridge
//                                                process via BRPOP
//
// In single-instance dev mode (no Redis) the module degrades to a local
// EventEmitter so the existing SSE flow keeps working without external deps.

const crypto = require('crypto');
const { EventEmitter } = require('events');

let cacheService = null;
try { cacheService = require('./cacheService'); } catch { cacheService = null; }

const HMAC_SECRET = process.env.BRIDGE_HMAC_SECRET ||
  // Per-process random key — only safe for single-instance; multi-instance
  // MUST set BRIDGE_HMAC_SECRET explicitly so both ends agree.
  crypto.randomBytes(32).toString('hex');

const _localBus = new EventEmitter();
_localBus.setMaxListeners(1000);

function sign(payload) {
  const h = crypto.createHmac('sha256', HMAC_SECRET);
  h.update(payload);
  return h.digest('hex');
}

function verify(payload, sig) {
  const expected = sign(payload);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// ── Publishing bridge events (called by the bridge subprocess) ─────────────
async function publishEvent(userId, evt) {
  const body = JSON.stringify(evt);
  const sig  = sign(body);
  const envelope = JSON.stringify({ body, sig });

  if (cacheService?._redisReady) {
    try {
      // Publish for live listeners (any instance can subscribe)
      await cacheService._redis.publish(`bridge:events:${userId}`, envelope);
      // Also XADD to a capped stream so a slow-joining listener can catch up
      await cacheService._redis.xadd(
        `bridge:stream:${userId}`,
        'MAXLEN', '~', '1000',
        '*',
        'envelope', envelope
      );
      return true;
    } catch (err) {
      // fall through to local bus
    }
  }
  _localBus.emit(`evt:${userId}`, evt);
  return false;
}

// ── Subscribing to bridge events (called by the API server) ────────────────
// Returns an unsubscribe function.
function subscribeEvents(userId, handler) {
  if (cacheService?._redisReady) {
    // Use a DEDICATED Redis connection because subscribe puts the connection
    // in pub/sub mode and disallows normal commands.
    const Redis = require('ioredis');
    const sub = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    const channel = `bridge:events:${userId}`;
    sub.subscribe(channel).catch(() => {});
    sub.on('message', (ch, envelope) => {
      try {
        const { body, sig } = JSON.parse(envelope);
        if (!verify(body, sig)) return;        // tampered → drop
        handler(JSON.parse(body));
      } catch (_) {}
    });
    return () => {
      sub.unsubscribe(channel).catch(() => {});
      sub.quit().catch(() => {});
    };
  }

  const localHandler = (evt) => handler(evt);
  _localBus.on(`evt:${userId}`, localHandler);
  return () => _localBus.off(`evt:${userId}`, localHandler);
}

// ── Replay recent events for a slow-joining subscriber ─────────────────────
async function replayRecent(userId, sinceMs = 5_000) {
  if (!cacheService?._redisReady) return [];
  try {
    const entries = await cacheService._redis.xrevrange(
      `bridge:stream:${userId}`,
      `${Date.now()}`,
      `${Date.now() - sinceMs}`,
      'COUNT', 20
    );
    const events = [];
    for (const [, fields] of entries) {
      const idx = fields.indexOf('envelope');
      if (idx < 0) continue;
      const { body, sig } = JSON.parse(fields[idx + 1]);
      if (!verify(body, sig)) continue;
      events.push(JSON.parse(body));
    }
    return events.reverse();
  } catch (_) {
    return [];
  }
}

// ── Sending commands to a bridge (server → bridge subprocess) ──────────────
async function sendCommand(userId, cmd) {
  // Stamp a wall-clock ts so the bridge can ignore commands that predate
  // its own boot (defeats the disconnect/initiate-qr race where a stale
  // 'disconnect' queued before the old bridge died kills the new one).
  if (cmd && cmd.ts == null) cmd = { ...cmd, ts: Date.now() };
  const body = JSON.stringify(cmd);
  const sig  = sign(body);
  const envelope = JSON.stringify({ body, sig });

  if (cacheService?._redisReady) {
    try {
      // Use LPUSH so the bridge's BRPOP picks it up immediately
      await cacheService._redis.lpush(`bridge:cmd:${userId}`, envelope);
      // Cap the queue at 100 to prevent runaway growth
      await cacheService._redis.ltrim(`bridge:cmd:${userId}`, 0, 99);
      return true;
    } catch (_) {}
  }
  _localBus.emit(`cmd:${userId}`, cmd);
  return false;
}

// ── Drain any queued commands for a user (called before spawning a bridge) ──
// Belt-and-suspenders against the disconnect/initiate race: clears stale
// commands so a freshly-spawned bridge starts with an empty queue.
async function clearCommands(userId) {
  if (cacheService?._redisReady) {
    try { await cacheService._redis.del(`bridge:cmd:${userId}`); } catch (_) {}
  }
}

// ── Bridge-side command receive loop ────────────────────────────────────────
// The bridge subprocess calls this with its userId; the handler fires for
// every command. Returns a cancel fn.
function receiveCommands(userId, handler) {
  if (cacheService?._redisReady) {
    let stopped = false;
    const Redis = require('ioredis');
    const consumer = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    const loop = async () => {
      while (!stopped) {
        try {
          const res = await consumer.brpop(`bridge:cmd:${userId}`, 5);
          if (!res) continue;
          const [, envelope] = res;
          try {
            const { body, sig } = JSON.parse(envelope);
            if (!verify(body, sig)) {
              console.warn('[bridgeBus] HMAC verification failed — dropping cmd');
              continue;
            }
            handler(JSON.parse(body));
          } catch (e) {
            console.warn('[bridgeBus] malformed cmd envelope:', e.message);
          }
        } catch (err) {
          if (stopped) break;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      consumer.quit().catch(() => {});
    };
    loop();
    return () => { stopped = true; };
  }

  const localHandler = (cmd) => handler(cmd);
  _localBus.on(`cmd:${userId}`, localHandler);
  return () => _localBus.off(`cmd:${userId}`, localHandler);
}

module.exports = {
  publishEvent,
  subscribeEvents,
  replayRecent,
  sendCommand,
  clearCommands,
  receiveCommands,
  // Exported for the bridge subprocess to know the agreed secret
  HMAC_SECRET,
  isDistributed: () => !!cacheService?._redisReady,
};
