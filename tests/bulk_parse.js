/**
 * Bulk Parse Test — parses all raw_messages and batch-inserts to listings.
 * Run: node tests/bulk_parse.js
 * (Run after bulk_insert.js to have data to parse)
 */
require('dotenv').config();
const { dbAll, dbRun, dbGet, db } = require('../src/api/db-helpers');
const { MessageParser } = require('../src/scraper/message-parser');
const { v4: uuidv4 } = require('uuid');

const BATCH_SIZE = 200;

async function insertBatch(rows) {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  const values = rows.flatMap(r => [
    r.id, r.raw_message_id, r.price, r.location, r.bedrooms,
    r.property_type, r.area_sqft, r.furnished, r.parking,
    r.agent_phone, r.agent_name, r.description, r.group_name,
    r.extraction_confidence, r.image_paths,
  ]);
  return dbRun(
    `INSERT OR IGNORE INTO listings
       (id, raw_message_id, price, location, bedrooms, property_type, area_sqft,
        furnished, parking, agent_phone, agent_name, description, group_name,
        extraction_confidence, image_paths)
     VALUES ${placeholders}`,
    values
  );
}

async function parseBulk() {
  console.log('\nBulk Parse Test');
  console.log('='.repeat(60));

  const messages = await dbAll('SELECT * FROM raw_messages LIMIT 50000');
  console.log(`Loaded ${messages.length.toLocaleString()} raw messages`);

  if (messages.length === 0) {
    console.log('No messages found. Run bulk_insert.js first.');
    db.close();
    return;
  }

  const parser = new MessageParser();
  const start = Date.now();
  let success = 0, skipped = 0, errors = 0;
  let batch = [];

  for (let i = 0; i < messages.length; i++) {
    try {
      const row = messages[i];
      const parsed = parser.parse(row.message_text || '', row.sender_name || '');

      if (parsed.confidence > 0.5) {
        batch.push({
          id: row.id, raw_message_id: row.id,
          price: parsed.price, location: parsed.location, bedrooms: parsed.bedrooms,
          property_type: parsed.property_type, area_sqft: parsed.area_sqft,
          furnished: parsed.furnished, parking: parsed.parking,
          agent_phone: parsed.agent_phone, agent_name: parsed.agent_name,
          description: parsed.description, group_name: row.group_name,
          extraction_confidence: parsed.confidence,
          image_paths: row.image_paths || '[]',
        });

        if (batch.length >= BATCH_SIZE) {
          await insertBatch(batch);
          success += batch.length;
          batch = [];
        }
      } else {
        skipped++;
      }
    } catch {
      errors++;
    }

    if ((i + 1) % 5000 === 0) {
      process.stdout.write(`  Processed ${(i + 1).toLocaleString()}...\n`);
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    await insertBatch(batch);
    success += batch.length;
  }

  const elapsed = Date.now() - start;
  const total = messages.length;
  const rate = ((success / total) * 100).toFixed(1);
  const listingCount = await dbGet('SELECT COUNT(*) as count FROM listings');
  const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  console.log('\n--- Results ---');
  console.log(`Time:          ${elapsed}ms  (limit: 60,000ms)  ${elapsed < 60000 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Rate:          ${(total / elapsed * 1000).toFixed(0)} msgs/sec`);
  console.log(`Success:       ${success.toLocaleString()}/${total.toLocaleString()} (${rate}%)  ${parseFloat(rate) > 70 ? '✓ PASS' : '✗ FAIL (expect >70%)'}`);
  console.log(`Skipped:       ${skipped.toLocaleString()} (low confidence)`);
  console.log(`Errors:        ${errors}${errors ? '  ✗ FAIL' : '  ✓ PASS'}`);
  console.log(`Listings in DB:${listingCount?.count?.toLocaleString()}`);
  console.log(`Heap memory:   ${heapMB} MB  (limit: 500 MB)  ${heapMB < 500 ? '✓ PASS' : '✗ FAIL'}`);

  const passed = elapsed < 60000 && parseFloat(rate) > 70 && errors === 0;
  console.log('\n' + (passed ? '✅ BULK PARSE PASSED' : '❌ BULK PARSE FAILED'));

  db.close();
}

parseBulk().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
