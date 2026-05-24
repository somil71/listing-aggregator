module.exports = {
  env: 'test',
  port: process.env.PORT || 3001,
  host: process.env.HOST || 'localhost',
  db: {
    path: ':memory:', // SQLite memory DB for testing
  },
  logging: {
    level: 'error'
  }
};
