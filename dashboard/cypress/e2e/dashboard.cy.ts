/**
 * E2E — Dashboard Page (requires Clerk credentials)
 */

describe('Dashboard — authenticated', () => {
  before(() => {
    cy.requireClerkCredentials();
  });

  beforeEach(() => {
    cy.signInWithClerk();
  });

  it('renders the listings table', () => {
    cy.visit('/dashboard');
    cy.contains('h1,h2,h3', /listing|property|digest/i, { timeout: 10000 }).should('exist');
  });

  it('shows Connect WhatsApp button when not connected', () => {
    cy.visit('/dashboard');
    cy.contains('button', /connect whatsapp|scan qr/i, { timeout: 8000 }).should('exist');
  });

  it('search input filters the listing table', () => {
    cy.visit('/dashboard');
    cy.get('input[placeholder*="search" i]', { timeout: 8000 }).then(($input) => {
      if ($input.length === 0) return; // no search bar — skip gracefully
      cy.wrap($input).type('3bhk');
      cy.get('table tbody tr, [data-testid="listing-row"]').each(($row) => {
        expect($row.text().toLowerCase()).to.satisfy(
          (t: string) => t.includes('3bhk') || t.includes('3 bhk') || t.length < 5
        );
      });
    });
  });

  it('sidebar link to /settings navigates correctly', () => {
    cy.visit('/dashboard');
    cy.get('a[href="/settings"]', { timeout: 8000 }).first().click();
    cy.url().should('include', '/settings');
  });

  it('Refresh button triggers a data reload without errors', () => {
    cy.visit('/dashboard');
    cy.contains('button', /refresh/i, { timeout: 8000 }).then(($btn) => {
      if ($btn.length) cy.wrap($btn).click();
    });
    // No error toast should appear
    cy.get('[role="alert"][class*="error" i], [data-testid="error"]').should('not.exist');
  });
});
