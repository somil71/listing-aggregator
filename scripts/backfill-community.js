// One-time backfill: scan all listings that have community=null and
// try to extract the location from their stored description using the
// regex parser's known-areas list + fuzzy patterns.
//
// Usage: node scripts/backfill-community.js
require('dotenv').config();
const pg = require('../src/db/postgres/pool');
const { MessageParser } = require('../src/scraper/message-parser');

const regexParser = new MessageParser();

async function main() {
  const rows = await pg.query(
    `SELECT l.id, l.description, r.text AS raw_text
       FROM listings l
       LEFT JOIN raw_messages r ON r.id = l.raw_message_id
      WHERE l.community IS NULL
      ORDER BY l.ts_listed DESC`
  );

  console.log(`Found ${rows.rows.length} listings with no community.`);

  let updated = 0;
  for (const row of rows.rows) {
    const text = row.raw_text || row.description || '';
    if (!text) continue;

    const community = regexParser.extractLocation(text);
    if (!community) continue;

    await pg.query(
      `UPDATE listings SET community = $1, area_text = COALESCE(area_text, $1)
         WHERE id = $2`,
      [community, row.id]
    );
    updated++;
    if (updated % 50 === 0) console.log(`  updated ${updated}…`);
  }

  console.log(`Done. Updated ${updated} / ${rows.rows.length} listings.`);
  await pg.close();
}

main().catch(err => { console.error(err); process.exit(1); });
