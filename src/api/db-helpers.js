const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../../data/db/listings.db');

// Ensure parent directory exists before sqlite tries to open the file
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Open database connection
const db = new sqlite3.Database(dbPath);

// Concurrency hardening — applied once at startup.
// WAL mode allows readers and writers to operate concurrently without
// each writer locking out all readers. busy_timeout gives SQLite up to
// 5 seconds to wait for a contended lock before throwing SQLITE_BUSY.
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA synchronous = NORMAL');  // safe with WAL, much faster
  db.run('PRAGMA foreign_keys = ON');
});

// Wrap database calls in Promises
const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

// Export helper functions
module.exports = {
  db,
  dbGet,
  dbAll,
  dbRun
  
};
