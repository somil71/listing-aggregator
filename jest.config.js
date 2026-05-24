module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/api/**/*.js',
    '!src/api/server.js'
  ],
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['dotenv-safe/config']
};
