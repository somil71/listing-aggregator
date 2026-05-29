require('dotenv').config();
const pg = require('../src/db/postgres/pool');
async function main() {
  const r = await pg.query(`
    SELECT l.currency, l.price, l.bedrooms, l.property_type, l.community, l.confidence,
           r.text
    FROM listings l
    LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.currency = 'AED' AND l.price IS NOT NULL
    ORDER BY l.confidence DESC
    LIMIT 10
  `);
  for (const row of r.rows) {
    console.log(`[AED] ${row.price} | ${row.bedrooms}BR ${row.property_type} | ${row.community} | conf=${row.confidence} | "${(row.text||'').slice(0,100)}"`);
  }
  await pg.close();
}
main().catch(e => console.error(e.message));
