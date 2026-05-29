const pg = require('../src/db/postgres/pool');
async function main() {
  // Confirm no URL-only listings made it through
  const urls = await pg.query(`SELECT COUNT(*) n FROM listings WHERE description LIKE 'https://%' AND price IS NOT NULL`);
  console.log('URL-only false positives with price:', urls.rows[0].n);

  // Summary by extracted_by + currency
  const r = await pg.query(`
    SELECT extracted_by, currency, COUNT(*) n
    FROM listings GROUP BY extracted_by, currency ORDER BY n DESC`);
  console.log('\nExtracted by / currency:');
  r.rows.forEach(row => console.log(`  ${(row.extracted_by||'?').padEnd(28)} [${(row.currency||'null').padEnd(4)}] ${row.n}`));
  await pg.close();
}
main().catch(e => console.error(e.message));
