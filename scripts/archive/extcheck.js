const pg = require('../src/db/postgres/pool');
pg.query("SELECT extracted_by, COUNT(*) n FROM listings GROUP BY extracted_by ORDER BY n DESC")
  .then(r => { r.rows.forEach(row => console.log(`${row.extracted_by}: ${row.n}`)); return pg.close(); });
