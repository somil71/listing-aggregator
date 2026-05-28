// Neon Postgres pool (uses pgbouncer-compatible connection pooler URL).
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — see .env');
}

// TLS: Neon's pooler endpoint uses a CA not in Node's default bundle, so we
// disable host verification by default. Set PG_SSL_REJECT_UNAUTHORIZED=true
// when connecting to a self-managed Postgres with a known CA chain.
const _rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: _rejectUnauthorized },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[pg pool] unexpected error on idle client:', err.message);
});

// Helpers that mirror the existing src/api/db-helpers.js sqlite shape so we
// can swap call-sites one-by-one without breaking everything.
async function dbAll(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function dbGet(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0];
}

async function dbRun(sql, params = []) {
  const res = await pool.query(sql, params);
  return { rowCount: res.rowCount, lastID: res.rows[0]?.id };
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, dbAll, dbGet, dbRun, query, withTransaction, close };
