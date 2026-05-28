// Apply migrations idempotently against Neon Postgres.
// Usage: node src/db/postgres/migrate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function applied() {
  const r = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(r.rows.map(x => x.filename));
}

async function run() {
  console.log('[migrate] connecting to', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] ?? '?');
  await ensureMigrationsTable();
  const done = await applied();

  const files = fs.readdirSync(__dirname)
    .filter(f => /^\d+_.+\.sql$/.test(f))
    .sort();

  let applied_count = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log('[migrate] skip', file, '(already applied)');
      continue;
    }
    console.log('[migrate] apply', file);
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      applied_count++;
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error('[migrate] FAILED on', file, '—', err.message);
      process.exit(1);
    }
  }
  console.log(`[migrate] done. ${applied_count} new migration(s) applied.`);
  await pool.end();
}

run().catch(err => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
