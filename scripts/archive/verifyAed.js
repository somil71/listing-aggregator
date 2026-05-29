require('dotenv').config();
const pg = require('../src/db/postgres/pool');
async function main() {
  const r = await pg.query(`
    SELECT l.currency, l.price, l.bedrooms, r.text
    FROM listings l
    LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.currency = 'AED' AND l.price IS NOT NULL
    LIMIT 8
  `);
  for (const row of r.rows) {
    console.log(`[AED] price=${row.price} beds=${row.bedrooms} text="${(row.text||'').replace(/\n/g,' ').slice(0,80)}"`);
  }
  await pg.close();
}
main().catch(e => console.error(e.message));
