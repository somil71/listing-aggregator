// Backfill unit_type (and correct bedrooms) for listings parsed before the
// unit_type column was added.
//
// Strategy: pure regex against the stored description / raw text.
// Only updates rows where unit_type IS NULL so it's safe to re-run.
//
// Run:  node scripts/backfill-unit-type.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const pg = require('../src/db/postgres/pool');

// Matches "2rk", "1 BHK", "3bk", "2 br", "2BR" etc. (case-insensitive, optional space)
// Capture group 1 = digit(s), group 2 = unit suffix
const UNIT_RE = /\b(\d+)\s*(rk|bhk|bk|br)\b/i;

async function main() {
  // Fetch listings missing unit_type that have a description to work with
  const { rows } = await pg.query(`
    SELECT l.id, l.description,
           r.text AS raw_text
    FROM listings l
    LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.unit_type IS NULL
      AND (l.description IS NOT NULL OR r.text IS NOT NULL)
    ORDER BY l.ts_listed DESC
  `);

  console.log(`[backfill-unit-type] ${rows.length} listings to examine`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    // Prefer raw message text (richer); fall back to stored description
    const text = row.raw_text || row.description || '';
    const match = text.match(UNIT_RE);

    if (!match) {
      skipped++;
      continue;
    }

    const bedrooms  = parseInt(match[1], 10);
    const unit_type = match[2].toUpperCase();  // 'RK' | 'BHK' | 'BK' | 'BR'

    await pg.query(
      `UPDATE listings
          SET bedrooms  = $1,
              unit_type = $2
        WHERE id = $3`,
      [bedrooms, unit_type, row.id]
    );

    updated++;
    console.log(`  ✓ ${row.id} → ${bedrooms} ${unit_type}  (from: "${text.slice(0, 80).trim()}")`);
  }

  console.log(`\n[backfill-unit-type] done — updated: ${updated}  no-match: ${skipped}`);
  await pg.close().catch(() => {});
}

main().catch(err => {
  console.error('[backfill-unit-type] fatal:', err);
  process.exit(1);
});
