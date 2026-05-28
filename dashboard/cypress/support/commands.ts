/**
 * Custom Cypress commands.
 *
 * Auth strategy:
 *   • When CYPRESS_CLERK_USER_EMAIL + CYPRESS_CLERK_USER_PASSWORD are set,
 *     we sign in through the real Clerk UI (integration tests).
 *   • Otherwise commands that require auth are skipped via cy.skip().
 *
 * To use Clerk's bypass token approach (faster, recommended for CI):
 *   1. Install @clerk/testing  (already done)
 *   2. Set CLERK_SECRET_KEY in your CI environment
 *   3. Call cy.clerkSetupTestingToken() in beforeEach
 */

declare global {
  namespace Cypress {
    interface Chainable {
      /** Sign in via the Clerk-hosted Sign In form. */
      signInWithClerk(email?: string, password?: string): Chainable<void>;
      /** Sign out by navigating to the Clerk sign-out endpoint. */
      signOut(): Chainable<void>;
      /** Skip the test if Clerk credentials are not configured. */
      requireClerkCredentials(): Chainable<void>;
    }
  }
}

Cypress.Commands.add('requireClerkCredentials', () => {
  const email    = Cypress.env('CLERK_USER_EMAIL');
  const password = Cypress.env('CLERK_USER_PASSWORD');
  if (!email || !password) {
    cy.log('⚠️  Clerk credentials not set — skipping authenticated test');
    // @ts-ignore
    return cy.wrap(null).then(() => { pending(); });
  }
});

Cypress.Commands.add('signInWithClerk', (
  email    = Cypress.env('CLERK_USER_EMAIL'),
  password = Cypress.env('CLERK_USER_PASSWORD'),
) => {
  cy.visit('/login');
  // Clerk's hosted Sign In component renders an iframe or inline form.
  // We target the email/password inputs inside the Clerk component.
  cy.get('input[name="identifier"]', { timeout: 10000 }).type(email);
  cy.get('button[data-localization-key="formButtonPrimary"]').click();
  cy.get('input[name="password"]', { timeout: 10000 }).type(password);
  cy.get('button[data-localization-key="formButtonPrimary"]').click();
  cy.url({ timeout: 15000 }).should('include', '/dashboard');
});

Cypress.Commands.add('signOut', () => {
  cy.window().then((win) => {
    // Clerk exposes window.Clerk
    if ((win as any).Clerk) {
      (win as any).Clerk.signOut();
    }
  });
  cy.url({ timeout: 10000 }).should('include', '/login');
});
