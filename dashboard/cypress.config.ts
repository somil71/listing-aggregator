import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 800,
    video: false,
    screenshotOnRunFailure: true,
    screenshotsFolder: '../reports/cypress/screenshots',

    // Retry flaky tests in CI
    retries: {
      runMode: 2,
      openMode: 0,
    },

    env: {
      // Set in CI: CYPRESS_CLERK_USER_EMAIL / CYPRESS_CLERK_USER_PASSWORD
      // or use Clerk's testing token approach (CLERK_SECRET_KEY must be set)
      CLERK_USER_EMAIL:    process.env.CYPRESS_CLERK_USER_EMAIL    ?? '',
      CLERK_USER_PASSWORD: process.env.CYPRESS_CLERK_USER_PASSWORD ?? '',
    },

    setupNodeEvents(on, config) {
      on('task', {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
      return config;
    },
  },
});
