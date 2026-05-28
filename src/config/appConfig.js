// Runtime config service — reads/writes the app_config Postgres table.
// 60-second in-memory cache so we don't hit Postgres on every parse.

const { dbAll, dbRun, dbGet } = require('../db/postgres/pool');

const cache = new Map();   // key → { value, expiresAt }
const TTL_MS = 60_000;

async function get(key, fallback = null) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  try {
    const row = await dbGet(
      `SELECT value FROM app_config WHERE key = $1 AND user_id IS NULL LIMIT 1`,
      [key]
    );
    const val = row ? row.value : fallback;
    cache.set(key, { value: val, expiresAt: now + TTL_MS });
    return val;
  } catch (err) {
    console.warn('[appConfig] read error for', key, '-', err.message);
    return fallback;
  }
}

async function getMany(keys) {
  const out = {};
  for (const k of keys) out[k] = await get(k);
  return out;
}

async function set(key, value, description = null) {
  await dbRun(
    `INSERT INTO app_config(key, value, description, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key, user_id) DO UPDATE
       SET value = EXCLUDED.value,
           description = COALESCE(EXCLUDED.description, app_config.description),
           updated_at = NOW()`,
    [key, JSON.stringify(value), description]
  );
  cache.delete(key);
}

async function all() {
  const rows = await dbAll('SELECT key, value, description, updated_at FROM app_config WHERE user_id IS NULL ORDER BY key');
  return rows;
}

function invalidate(key) { if (key) cache.delete(key); else cache.clear(); }

module.exports = { get, getMany, set, all, invalidate };
