const env = process.env.NODE_ENV || 'development';

const base = {
  port: parseInt(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || 'data/db/listings.db',
};

const envConfig = {
  development: {
    ...base,
    logLevel: 'debug',
    cacheTTL: {
      listings: 0,
      agents:   0,
      groups:   0,
      search:   0,
    },
    rateLimit: { windowMs: 15 * 60 * 1000, max: 10000 },
    searchRateLimit: { windowMs: 15 * 60 * 1000, max: 500 },
  },
  staging: {
    ...base,
    logLevel: 'info',
    cacheTTL: {
      listings: 5 * 60 * 1000,
      agents:   15 * 60 * 1000,
      groups:   15 * 60 * 1000,
      search:   10 * 60 * 1000,
    },
    rateLimit: { windowMs: 15 * 60 * 1000, max: 1000 },
    searchRateLimit: { windowMs: 15 * 60 * 1000, max: 60 },
  },
  production: {
    ...base,
    logLevel: 'warn',
    cacheTTL: {
      listings: 5 * 60 * 1000,
      agents:   15 * 60 * 1000,
      groups:   15 * 60 * 1000,
      search:   10 * 60 * 1000,
    },
    rateLimit: { windowMs: 15 * 60 * 1000, max: 500 },
    searchRateLimit: { windowMs: 15 * 60 * 1000, max: 30 },
  },
};

module.exports = envConfig[env] || envConfig.development;
