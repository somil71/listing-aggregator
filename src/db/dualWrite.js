// Dual-write layer: write raw messages to SQLite (existing source of truth)
// AND Postgres (the new target). Listings table is Postgres-only going forward.
//
// Strategy:
//   1. SQLite write happens first — if it fails, abort (keeps old app stable)
//   2. Postgres write happens second — failures are logged but don't abort
//   3. After both writes, enqueue a parse job to Upstash for the worker

const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const sqlite = require('../api/db-helpers');                    // SQLite (current)
const pg = require('./postgres/pool');                          // Postgres (new)
const queue = require('../queue/upstashClient');

const PARSE_QUEUE = 'parse:listings';

// ── User mapping cache: clerk_user_id → uuid ──────────────────────────────
// Bounded LRU so a long-running server with churning users cannot leak memory.
// 10,000 users × 1h TTL gives the hot set a fast path while old entries auto-evict.
const _userIdCache = new LRUCache({
  max: 10_000,
  ttl: 60 * 60 * 1000,   // 1 hour
  ttlAutopurge: true,    // purge expired entries in the background
});

async function ensureUser(clerkUserId, opts = {}) {
  const cached = _userIdCache.get(clerkUserId);
  if (cached) return cached;
  // INSERT … ON CONFLICT DO NOTHING, then SELECT (idempotent)
  await pg.dbRun(
    `INSERT INTO users (clerk_user_id, email, market)
     VALUES ($1, $2, $3)
     ON CONFLICT (clerk_user_id) DO NOTHING`,
    [clerkUserId, opts.email || null, opts.market || 'dubai']
  );
  const row = await pg.dbGet(
    'SELECT id FROM users WHERE clerk_user_id = $1',
    [clerkUserId]
  );
  if (!row) throw new Error('Could not resolve user uuid for ' + clerkUserId);
  _userIdCache.set(clerkUserId, row.id);
  return row.id;
}

function contentHash(text) {
  return crypto.createHash('sha256')
    .update((text || '').trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

// ── Write a raw message to both stores + enqueue parsing ──────────────────
// `msg` shape:
//   { user_id, wa_group_id, wa_message_id, sender_wa_id, sender_name,
//     text, ts_received, has_media, media_keys, group_name }
async function writeRawMessage(msg) {
  // SQLite is written by persistMessage (Path A) BEFORE dualWrite is called.
  // Re-inserting here would be a no-op (INSERT OR IGNORE hits the conflict)
  // but if the already-open SQLite connection hasn't seen the latest schema
  // changes it can throw — and the old `throw err` blocked the Postgres write
  // entirely.  We skip the SQLite re-insert here so dualWrite is purely the
  // Postgres + parse-queue path; persistMessage owns SQLite.
  const sqliteId = msg.wa_message_id;

  // Postgres (primary durable store)
  let pgRawId = null;
  try {
    const userUuid = await ensureUser(msg.user_id);
    const ch = contentHash(msg.text);
    const res = await pg.query(
      `INSERT INTO raw_messages
         (user_id, wa_group_id, wa_message_id, sender_wa_id, sender_name,
          text, has_media, media_keys, content_hash, ts_received)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, wa_message_id) DO NOTHING
       RETURNING id`,
      [
        userUuid, msg.wa_group_id, msg.wa_message_id,
        msg.sender_wa_id || null, msg.sender_name || null,
        msg.text || '', !!msg.has_media,
        msg.media_keys || [], ch,
        msg.ts_received instanceof Date ? msg.ts_received : new Date(msg.ts_received),
      ]
    );
    pgRawId = res.rows[0]?.id;

    // Update the monitored_groups counter
    await pg.query(
      `UPDATE monitored_groups SET message_count = message_count + 1,
              last_message_at = $1
         WHERE user_id = $2 AND wa_group_id = $3`,
      [msg.ts_received, userUuid, msg.wa_group_id]
    );
  } catch (err) {
    console.warn('[dualWrite] postgres raw insert failed:', err.message);
  }

  // 3. Enqueue parse job (only if PG insert succeeded — no point parsing
  //    a row we can't link back to)
  if (pgRawId) {
    try {
      await queue.enqueue(PARSE_QUEUE, {
        raw_id: pgRawId,
        text: msg.text,
        sender_name: msg.sender_name,
        wa_group_id: msg.wa_group_id,
        group_name: msg.group_name,
        ts_received: msg.ts_received,
      });
    } catch (err) {
      console.warn('[dualWrite] enqueue failed:', err.message);
    }
  }

  return { sqliteId, pgRawId };
}

module.exports = {
  writeRawMessage,
  ensureUser,
  contentHash,
  PARSE_QUEUE,
};
