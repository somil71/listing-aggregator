module.exports = {
  env: 'production',
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  db: {
    path: process.env.DATABASE_PATH || '/var/data/listings.db',
  },
  logging: {
    level: 'info'
  }
};
