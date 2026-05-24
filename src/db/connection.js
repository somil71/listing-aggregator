const sqlite3 = require('sqlite3').verbose();
const dbConfig = require('../config/database');
const logger = require('../config/logger');

class DatabaseConnection {
  constructor() {
    this.db = null;
    this.retryCount = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(
        dbConfig.path,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (err) => {
          if (err) {
            return this._handleConnectionError(err, resolve, reject);
          }
          // Enable WAL mode for better concurrent read performance
          this.db.run('PRAGMA journal_mode = WAL');
          this.db.run('PRAGMA foreign_keys = ON');
          this.db.configure('busyTimeout', dbConfig.timeout.default);
          logger.info('Database connected', { path: dbConfig.path });
          this.retryCount = 0;
          resolve();
        }
      );
    });
  }

  _handleConnectionError(error, resolve, reject) {
    if (this.retryCount < dbConfig.retry.maxAttempts) {
      this.retryCount++;
      logger.warn(`DB connect failed, retrying (${this.retryCount}/${dbConfig.retry.maxAttempts})`, {
        error: error.message
      });
      setTimeout(() => this.connect().then(resolve).catch(reject),
        dbConfig.retry.delayMs * this.retryCount);
    } else {
      logger.error('DB connection permanently failed', { error: error.message });
      reject(error);
    }
  }

  // Execute a write query (INSERT / UPDATE / DELETE)
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not connected'));
      const t = setTimeout(() => reject(new Error('DB query timeout')), dbConfig.timeout.write);
      this.db.run(sql, params, function (err) {
        clearTimeout(t);
        err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // Fetch a single row
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not connected'));
      const t = setTimeout(() => reject(new Error('DB query timeout')), dbConfig.timeout.read);
      this.db.get(sql, params, (err, row) => {
        clearTimeout(t);
        err ? reject(err) : resolve(row || null);
      });
    });
  }

  // Fetch all rows
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not connected'));
      const t = setTimeout(() => reject(new Error('DB query timeout')), dbConfig.timeout.read);
      this.db.all(sql, params, (err, rows) => {
        clearTimeout(t);
        err ? reject(err) : resolve(rows || []);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => {
        if (err) {
          logger.error('Error closing DB', { error: err.message });
          return reject(err);
        }
        logger.info('Database connection closed');
        this.db = null;
        resolve();
      });
    });
  }

  isConnected() {
    return this.db !== null;
  }
}

// Singleton
let instance = null;
const getConnection = () => {
  if (!instance) instance = new DatabaseConnection();
  return instance;
};

module.exports = { getConnection, DatabaseConnection };
