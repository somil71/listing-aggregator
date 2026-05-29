// One-time fix: listings where community was wrongly set to a property attribute
// like "Fully Furnished", "With Owner", "Singal Story" instead of an actual location.
//
// Strategy:
//   1. Find listings whose community matches known non-location patterns
//   2. NULL out community (and area_text if it has the same wrong value)
//   3. Re-run the regex extractor on the raw message text
//   4. Update if a real location is found
//
// Usage: node scripts/fix-bad-community.js
require('dotenv').config();
const pg = require('../src/db/postgres/pool');
const { MessageParser } = require('../src/scraper/message-parser');

const regexParser = new MessageParser();

// Same non-location pattern used in the display layer
const NON_LOC_RE = /\b(?:furnished|unfurnished|owner|story|storey|available|vacant|rent|sale|lease|flat[s]?|studio|apartment[s]?|house|room[s]?|looking|wanted|independent|semi|bhk|rk|bk|sqft|sqm|bed|almirah?|fridge|washing|machine|sofa|geyser|wardrobe|balcon|kitchen|parking|lift|gym|pool|floor|contact|call)\b/i;

async function main() {
  const { rows } = await pg.query(
    `SELECT l.id, l.community, l.area_text, r.text AS raw_text, l.description
       FROM listings l
       LEFT JOIN raw_messages r ON r.id = l.raw_message_id
      WHERE l.community IS NOT NULL
      ORDER BY l.ts_listed DESC`
  );

  console.log(`Scanning ${rows.length} listings with non-null community…`);

  let nulled = 0, fixed = 0, skipped = 0;

  for (const row of rows) {
    // Also reject community strings that start with a digit ("23k", "1 bhk", "2 rk …")
    const isDigitStart = /^\d/.test(row.community);
    if (!NON_LOC_RE.test(row.community) && !isDigitStart) { skipped++; continue; }

    console.log(`  BAD: id=${row.id} community="${row.community}"`);

    // Try to find the real location from raw text
    const text = row.raw_text || row.description || '';
    const realLoc = text ? regexParser.extractLocation(text) : null;

    if (realLoc) {
      await pg.query(
        `UPDATE listings
            SET community = $1,
                area_text = CASE WHEN area_text = $2 THEN $1 ELSE area_text END
          WHERE id = $3`,
        [realLoc, row.community, row.id]
      );
      console.log(`    → fixed to "${realLoc}"`);
      fixed++;
    } else {
      // NULL it out so the display fallback can try from description
      await pg.query(
        `UPDATE listings
            SET community = NULL,
                area_text = CASE WHEN area_text = $1 THEN NULL ELSE area_text END
          WHERE id = $2`,
        [row.community, row.id]
      );
      console.log(`    → nulled (no location found in text)`);
      nulled++;
    }
  }

  console.log(`\nDone. Fixed: ${fixed}  Nulled: ${nulled}  OK: ${skipped}`);
  await pg.close();
}

main().catch(err => { console.error(err); process.exit(1); });
