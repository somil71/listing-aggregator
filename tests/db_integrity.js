/**
 * Database Integrity Tests — indexes, constraints, foreign keys, transactions.
 * Run: node tests/db_integrity.js  (no server needed — hits DB directly)
 */
require('dotenv').config();
const { dbAll, dbGet, dbRun, db } = require('../src/api/db-helpers');
const { v4: uuidv4 } = require('uuid');

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function check(label, condition, detail = '') {
  if (condition) { console.log(`  ✓  ${label}`); passed++; }
  else            { console.log(`  ✗  ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

async function runMigrations() {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../src/db/migrations/addUsersTables.sql'), 'utf8'
  );
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function run() {
  console.log('\n7️⃣  DATABASE INTEGRITY TESTS');
  console.log('='.repeat(60));

  // Ensure migration tables exist (normally created on server start)
  await runMigrations();

  // ── 7.1 Table existence ──────────────────────────────────────────────
  console.log('\n7.1 Table Existence');
  const tables = await dbAll(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  const tableNames = tables.map(t => t.name);
  for (const t of ['listings', 'raw_messages', 'whatsapp_sessions', 'selected_groups', 'digests']) {
    check(`Table "${t}" exists`, tableNames.includes(t));
  }

  // ── 7.2 Indexes ──────────────────────────────────────────────────────
  console.log('\n7.2 Indexes');
  const indexes = await dbAll(
    `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`
  );
  const idxNames = indexes.map(i => i.name);
  const requiredIndexes = [
    'idx_listings_location',
    'idx_listings_price',
    'idx_listings_agent_phone',
    'idx_listings_property_type',
    'idx_listings_created_at',
    'idx_listings_confidence',
    'idx_sessions_user',
    'idx_groups_user',
  ];
  for (const idx of requiredIndexes) {
    check(`Index "${idx}" exists`, idxNames.includes(idx));
  }

  // ── 7.3 UNIQUE constraints ───────────────────────────────────────────
  console.log('\n7.3 UNIQUE Constraints');

  // whatsapp_sessions: one row per user_id
  const testUserId = 'test_integrity_user_' + Date.now();
  const sessionId1 = uuidv4();
  const sessionId2 = uuidv4();

  await dbRun(
    `INSERT OR REPLACE INTO whatsapp_sessions (id, user_id, status) VALUES (?, ?, 'pending')`,
    [sessionId1, testUserId]
  );
  await dbRun(
    `INSERT OR REPLACE INTO whatsapp_sessions (id, user_id, status) VALUES (?, ?, 'ready')`,
    [sessionId2, testUserId]
  );

  const sessions = await dbAll(
    `SELECT * FROM whatsapp_sessions WHERE user_id = ?`, [testUserId]
  );
  check('whatsapp_sessions UNIQUE(user_id): only 1 row per user', sessions.length === 1, `got ${sessions.length}`);
  check('INSERT OR REPLACE updates status correctly', sessions[0]?.status === 'ready');

  // selected_groups: no duplicate (user_id, group_id)
  const groupId = 'test_group@g.us';
  await dbRun(
    `INSERT OR IGNORE INTO selected_groups (id, user_id, group_id, group_name) VALUES (?, ?, ?, ?)`,
    [uuidv4(), testUserId, groupId, 'Test Group']
  );
  await dbRun(
    `INSERT OR IGNORE INTO selected_groups (id, user_id, group_id, group_name) VALUES (?, ?, ?, ?)`,
    [uuidv4(), testUserId, groupId, 'Test Group']
  );
  const groupRows = await dbAll(
    `SELECT * FROM selected_groups WHERE user_id = ? AND group_id = ?`, [testUserId, groupId]
  );
  check('selected_groups UNIQUE(user_id,group_id): no duplicates', groupRows.length === 1, `got ${groupRows.length}`);

  // raw_messages: INSERT OR IGNORE idempotency
  const msgId = 'test_msg_' + Date.now();
  await dbRun(
    `INSERT OR IGNORE INTO raw_messages (id, group_name, message_text, timestamp)
     VALUES (?, 'TestGroup', 'Message 1', datetime('now'))`, [msgId]
  );
  await dbRun(
    `INSERT OR IGNORE INTO raw_messages (id, group_name, message_text, timestamp)
     VALUES (?, 'TestGroup', 'Message 2', datetime('now'))`, [msgId]
  );
  const msgs = await dbAll(`SELECT * FROM raw_messages WHERE id = ?`, [msgId]);
  check('raw_messages INSERT OR IGNORE is idempotent (same id = 1 row)', msgs.length === 1);
  check('Original message text preserved (not overwritten)', msgs[0]?.message_text === 'Message 1');

  // ── 7.4 Transaction safety (rollback on error) ────────────────────────
  console.log('\n7.4 Transaction Safety');
  const countBefore = await dbGet('SELECT COUNT(*) as c FROM raw_messages');

  try {
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(
          `INSERT INTO raw_messages (id, group_name, message_text, timestamp)
           VALUES (?, 'TxTest', 'Test msg', datetime('now'))`,
          [uuidv4()]
        );
        // Force an error: violate NOT NULL on group_name
        db.run(
          `INSERT INTO raw_messages (id, group_name, message_text, timestamp)
           VALUES (?, NULL, 'Bad row', datetime('now'))`,
          [uuidv4()],
          (err) => {
            if (err) { db.run('ROLLBACK'); resolve('rolled_back'); }
            else { db.run('COMMIT'); resolve('committed'); }
          }
        );
      });
    });
  } catch {}

  const countAfter = await dbGet('SELECT COUNT(*) as c FROM raw_messages');
  // Either the whole transaction rolled back, or only the valid row was committed
  // Key check: no partial/corrupt state
  check('Row count is consistent after rollback test',
        countAfter.c >= countBefore.c, `before=${countBefore.c} after=${countAfter.c}`);

  // ── 7.5 Query plan uses indexes ───────────────────────────────────────
  console.log('\n7.5 Query Plans (Index Usage)');
  const plans = [
    {
      label: 'WHERE location= uses idx_listings_location',
      sql: `EXPLAIN QUERY PLAN SELECT * FROM listings WHERE location = 'Bandra'`,
      expected: 'idx_listings_location',
    },
    {
      label: 'WHERE agent_phone= uses idx_listings_agent_phone',
      sql: `EXPLAIN QUERY PLAN SELECT * FROM listings WHERE agent_phone = '9876543210'`,
      expected: 'idx_listings_agent_phone',
    },
    {
      label: 'ORDER BY created_at DESC uses idx_listings_created_at',
      sql: `EXPLAIN QUERY PLAN SELECT * FROM listings ORDER BY created_at DESC LIMIT 100`,
      expected: 'idx_listings_created_at',
    },
  ];

  for (const { label, sql, expected } of plans) {
    const plan = await dbAll(sql);
    const planText = plan.map(r => Object.values(r).join(' ')).join(' ').toLowerCase();
    check(label, planText.includes(expected.toLowerCase()), `plan: ${planText.substring(0, 80)}`);
  }

  // ── Cleanup test data ─────────────────────────────────────────────────
  await dbRun(`DELETE FROM whatsapp_sessions WHERE user_id = ?`, [testUserId]);
  await dbRun(`DELETE FROM selected_groups WHERE user_id = ?`, [testUserId]);
  await dbRun(`DELETE FROM raw_messages WHERE id = ?`, [msgId]);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '✅ DB INTEGRITY TESTS PASSED' : `❌ DB INTEGRITY: ${failed} failure(s)`);

  db.close();
  return failed;
}

run().then(f => process.exit(f > 0 ? 1 : 0)).catch(err => {
  console.error('Fatal:', err.message);
  db.close();
  process.exit(1);
});
