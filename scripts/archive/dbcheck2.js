require('dotenv').config();
const pg = require('../src/db/postgres/pool');
async function main() {
  const r = await pg.query(`
    SELECT l.currency, l.price, l.bedrooms, l.property_type, l.community,
           r.text, l.group_name
    FROM listings l
    LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.currency IS NULL OR l.currency = 'INR'
    ORDER BY l.ts_listed DESC
    LIMIT 10
  `);
  for (const row of r.rows) {
    console.log(`[${row.currency||'null'}] ${row.price} | ${row.bedrooms}BR ${row.property_type} | ${row.community} | text: "${(row.text||'').slice(0,80)}"`);
  }
  await pg.close();
}
main().catch(e => console.error(e.message));
