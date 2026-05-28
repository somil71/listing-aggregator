module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/scraper/whatsapp-qr-bridge.js',  // spawns Chromium — integration only
    '!src/worker/messageWorker.js',          // deprecated
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 15_000,
  clearMocks: true,
  restoreMocks: true,
};
