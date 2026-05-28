/**
 * Bulk Insert Test — inserts 50,000 raw messages in batches of 100.
 * Run: node tests/bulk_insert.js
 */
require('dotenv').config();
const { dbRun, dbGet, db } = require('../src/api/db-helpers');
const { v4: uuidv4 } = require('uuid');

const LOCATIONS = ['Bandra', 'Andheri', 'Juhu', 'Powai', 'Worli',
  'Whitefield', 'Koramangala', 'HSR Layout', 'Hinjewadi', 'Baner',
  'Gurgaon', 'Noida', 'Dwarka', 'HITEC City', 'Madhapur'];

const MESSAGES = [
  '3BHK flat in {loc}, ₹{price}Cr, 1800sqft, furnished, parking, call 9876543210',
  '2bhk apartment {loc} ₹{price}L semi-furnished 1100sqft 9812345678',
  'Villa for sale {loc} ₹{price}Cr 3500sqft 4BHK with parking 9998887776',
  'Office space {loc} ₹{price}L 500sqft commercial 9123456789',
  '1BHK {loc} ₹{price}L unfurnished 650sqft agent 9765432100',
];

function randomMessage(i) {
  const loc = LOCATIONS[i % LOCATIONS.length];
  const price = (Math.random() * 9 + 0.5).toFixed(1);
  const template = MESSAGES[i % MESSAGES.length];
  return template.replace('{loc}', loc).replace('{price}', price);
}

async function insertBulk(total = 50000, batchSize = 100) {
  console.log(`\nBulk Insert Test — ${total.toLocaleString()} messages in batches of ${batchSize}`);
  console.log('='.repeat(60));

  const start = Date.now();
  let inserted = 0;
  const errors = [];

  for (let i = 0; i < total; i += batchSize) {
    const placeholders = [];
    const values = [];

    for (let j = 0; j < batchSize && i + j < total; j++) {
      const idx = i + j;
      placeholders.push('(?,?,?,?,?,?,?,?)');
      values.push(
        uuidv4(),
        `Test Group ${(idx % 5) + 1}`,
        `Agent ${idx % 10}`,
        randomMessage(idx),
        new Date(Date.now() - Math.random() * 86400000).toISOString(),
        0, 0, '[]'
      );
    }

    const sql = `
      INSERT OR IGNORE INTO raw_messages
        (id, group_name, sender_name, message_text, timestamp, has_images, image_count, image_paths)
      VALUES ${placeholders.join(',')}
    `;

    try {
      await dbRun(sql, values);
      inserted += batchSize;
    } catch (err) {
      errors.push(`Batch ${i / batchSize + 1}: ${err.message}`);
    }

    if ((i + batchSize) % 5000 === 0) {
      process.stdout.write(`  Inserted ${(i + batchSize).toLocaleString()}...\n`);
    }
  }

  const elapsed = Date.now() - start;
  const finalCount = await dbGet('SELECT COUNT(*) as count FROM raw_messages');

  console.log('\n--- Results ---');
  console.log(`Time:          ${elapsed}ms  (limit: 30,000ms)  ${elapsed < 30000 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Rate:          ${(total / elapsed * 1000).toFixed(0)} msgs/sec`);
  console.log(`Errors:        ${errors.length}${errors.length ? '  ✗ FAIL' : '  ✓ PASS'}`);
  console.log(`DB row count:  ${finalCount?.count?.toLocaleString()}`);

  if (errors.length) {
    console.log('\nErrors:');
    errors.slice(0, 5).forEach(e => console.log('  ' + e));
  }

  // File size check
  const { statSync } = require('fs');
  const { join } = require('path');
  const dbPath = join(__dirname, '../data/db/listings.db');
  try {
    const stats = statSync(dbPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`DB file size:  ${sizeMB} MB  (limit: 100 MB)  ${parseFloat(sizeMB) < 100 ? '✓ PASS' : '✗ FAIL'}`);
  } catch {}

  console.log('\n' + (errors.length === 0 && elapsed < 30000 ? '✅ BULK INSERT PASSED' : '❌ BULK INSERT FAILED'));

  db.close();
}

insertBulk().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
