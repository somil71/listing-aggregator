module.exports = {
  // API versioning
  apiVersion: 'v1',
  apiPrefix: '/api/v1',

  // Legacy prefix alias (keeps frontend working without changes)
  legacyPrefix: '/api',

  // Pagination defaults
  pagination: {
    defaultLimit: 50,
    maxLimit: 500,
    defaultOffset: 0
  },

  // Query defaults
  query: {
    defaultSort: 'created_at',
    defaultOrder: 'DESC',
    confidenceThreshold: 0.5
  },

  // Timeout settings (ms)
  timeout: {
    request: 30000,
    database: 10000
  }
};
