// Opens DB with a busy timeout so it waits for the lock to clear
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/db/listings.db');
const db = new sqlite3.Database(dbPath);

// Give up to 30 seconds waiting for lock
db.configure('busyTimeout', 30000);

db.serialize(() => {
  db.run("DELETE FROM listings WHERE group_name LIKE 'Test Group %'", function(err) {
    console.log('listings deleted:', err ? err.message : this.changes);
  });
  db.run("DELETE FROM raw_messages WHERE group_name LIKE 'Test Group %'", function(err) {
    console.log('raw_messages deleted:', err ? err.message : this.changes);
  });
  db.all(
    'SELECT group_name, COUNT(*) as n FROM listings GROUP BY group_name ORDER BY n DESC',
    [],
    (err, rows) => {
      if (err) console.error(err.message);
      else console.log('Remaining groups:\n' + JSON.stringify(rows, null, 2));
      db.close(() => console.log('Done.'));
    }
  );
});
