const pg = require('../src/db/postgres/pool');
async function main() {
  // Show AED listings
  const aed = await pg.query(`
    SELECT l.currency, l.price, l.community, r.text
    FROM listings l LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.currency = 'AED'`);
  console.log("=== AED listings ===");
  for (const r of aed.rows) console.log(`  price=${r.price} loc=${r.community} | "${(r.text||'').replace(/\n/g,' ').slice(0,70)}"`);

  // Show a sample of null listings
  const nulls = await pg.query(`
    SELECT l.price, l.confidence, r.text
    FROM listings l LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.currency IS NULL LIMIT 5`);
  console.log("\n=== Sample NULL listings ===");
  for (const r of nulls.rows) console.log(`  price=${r.price} conf=${parseFloat(r.confidence).toFixed(2)} text="${(r.text||'').slice(0,60)}"`);
  await pg.close();
}
main().catch(e => console.error(e.message));
