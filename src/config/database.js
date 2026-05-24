const path = require('path');
const envConfig = require('./env');

module.exports = {
  // Absolute path to database (prevents hardcoding across files)
  path: envConfig.db.path,

  // Retry logic for connection failures
  retry: {
    maxAttempts: 3,
    delayMs: 1000
  },

  // Query timeouts (ms)
  timeout: {
    default: 30000,
    read: 10000,
    write: 30000
  }
};
