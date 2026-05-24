module.exports = {
  env: 'development',
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  db: {
    path: process.env.DATABASE_PATH || require('path').join(__dirname, '../../../data/db/listings.db'),
  },
  logging: {
    level: 'debug'
  }
};
