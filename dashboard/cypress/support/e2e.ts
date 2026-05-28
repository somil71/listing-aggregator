/**
 * Cypress E2E support file — loaded before every spec.
 * Extends Cypress with Clerk testing commands.
 */
import './commands';

// Suppress known benign Clerk/React uncaught exceptions
Cypress.on('uncaught:exception', (err) => {
  // Clerk SDK navigation errors during test setup are harmless
  if (
    err.message.includes('ResizeObserver loop') ||
    err.message.includes('Non-Error promise rejection') ||
    err.message.includes('clerk')
  ) {
    return false;
  }
});
