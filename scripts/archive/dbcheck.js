require('dotenv').config();
const pg = require('../src/db/postgres/pool');
async function main() {
  const r1 = await pg.query("SELECT COUNT(*) n FROM raw_messages");
  const r2 = await pg.query("SELECT COUNT(*) n FROM listings");
  const r3 = await pg.query("SELECT COALESCE(currency,'null') currency, COUNT(*) n FROM listings GROUP BY currency ORDER BY n DESC");
  console.log('raw_messages:', r1.rows[0].n);
  console.log('listings:', r2.rows[0].n);
  console.log('by currency:', JSON.stringify(r3.rows));
  await pg.close();
}
main().catch(e => { console.error(e.message); process.exit(1); });
