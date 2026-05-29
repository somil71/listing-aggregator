require('dotenv').config();
const pg = require('../src/db/postgres/pool');
const queue = require('../src/queue/upstashClient');
async function main() {
  const qLen = await queue.queueLength('parse:listings');
  const r = await pg.query("SELECT COALESCE(currency,'null') currency, COUNT(*) n FROM listings GROUP BY currency ORDER BY n DESC");
  const total = await pg.query("SELECT COUNT(*) n FROM listings");
  console.log('Queue depth:', qLen);
  console.log('Listings total:', total.rows[0].n);
  console.log('By currency:', JSON.stringify(r.rows));
  await pg.close();
}
main().catch(e => console.error(e.message));
