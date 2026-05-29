const pg = require('../src/db/postgres/pool');
async function main() {
  const r = await pg.query(`
    SELECT l.currency, l.price, l.community, l.confidence, l.extracted_by,
           LEFT(r.text, 70) AS snippet
    FROM listings l
    LEFT JOIN raw_messages r ON r.id = l.raw_message_id
    WHERE l.price IS NOT NULL
    ORDER BY l.confidence DESC
    LIMIT 12
  `);
  for (const row of r.rows) {
    const disp = row.currency === 'INR'
      ? (row.price >= 100000 ? `INR ${(row.price/100000).toFixed(1)}L` : `INR ${parseInt(row.price).toLocaleString()}`)
      : row.currency === 'AED' ? `AED ${parseInt(row.price).toLocaleString()}`
      : `??? ${parseInt(row.price).toLocaleString()}`;
    console.log(`[${(row.extracted_by||'').split(':')[0].padEnd(10)}] ${disp.padEnd(18)} | ${row.community||'?'} | conf=${parseFloat(row.confidence).toFixed(2)} | ${(row.snippet||'').replace(/\n/g,' ')}`);
  }
  await pg.close();
}
main().catch(e => console.error(e.message));
