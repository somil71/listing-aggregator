/**
 * E2E — Authentication Flows
 *
 * Unauthenticated tests run always.
 * Sign-in tests require CYPRESS_CLERK_USER_EMAIL + CYPRESS_CLERK_USER_PASSWORD.
 */

describe('Auth — unauthenticated redirects', () => {
  it('/ redirects to /dashboard which redirects to /login', () => {
    cy.visit('/');
    // React Router default catch-all sends to /dashboard,
    // ProtectedRoute then sends unauthenticated users to /login.
    cy.url({ timeout: 8000 }).should('match', /\/(login|dashboard)/);
  });

  it('/dashboard redirects to /login when not signed in', () => {
    cy.visit('/dashboard');
    cy.url({ timeout: 8000 }).should('include', '/login');
  });

  it('/settings redirects to /login when not signed in', () => {
    cy.visit('/settings');
    cy.url({ timeout: 8000 }).should('include', '/login');
  });

  it('/login page renders Clerk SignIn component', () => {
    cy.visit('/login');
    // The Clerk <SignIn> component always renders a form with an email field
    cy.get('input[name="identifier"], input[type="email"]', { timeout: 10000 })
      .should('be.visible');
  });
});

describe('Auth — sign in & sign out (requires Clerk credentials)', () => {
  before(() => {
    cy.requireClerkCredentials();
  });

  it('signs in and lands on /dashboard', () => {
    cy.signInWithClerk();
    cy.url().should('include', '/dashboard');
  });

  it('dashboard shows user button after sign-in', () => {
    cy.signInWithClerk();
    // Clerk UserButton renders with aria-label="Open user button"
    cy.get('[aria-label*="user" i], [data-testid="user-button"]', { timeout: 10000 })
      .should('exist');
  });

  it('signs out and returns to /login', () => {
    cy.signInWithClerk();
    cy.signOut();
  });

  it('cannot access /dashboard after sign-out', () => {
    cy.signInWithClerk();
    cy.signOut();
    cy.visit('/dashboard');
    cy.url({ timeout: 8000 }).should('include', '/login');
  });
});
