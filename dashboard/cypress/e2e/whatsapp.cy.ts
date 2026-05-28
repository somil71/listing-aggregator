/**
 * E2E — WhatsApp Connection UX (requires Clerk credentials)
 *
 * These tests validate the modal flow without actually scanning a QR code.
 * They verify the UI states that are reachable without a real WhatsApp account.
 */

describe('WhatsApp — QR modal flow', () => {
  before(() => {
    cy.requireClerkCredentials();
  });

  beforeEach(() => {
    cy.signInWithClerk();
    cy.visit('/dashboard');
  });

  it('Connect WhatsApp button opens the QR modal', () => {
    cy.contains('button', /connect whatsapp|scan qr/i, { timeout: 8000 }).click();
    cy.get('[role="dialog"], [data-testid="qr-modal"]', { timeout: 5000 }).should('be.visible');
  });

  it('QR modal shows a loading or QR image state', () => {
    cy.contains('button', /connect whatsapp|scan qr/i, { timeout: 8000 }).click();
    // Either show loading spinner or the QR canvas/img
    cy.get(
      '[data-testid="qr-modal"] canvas, [data-testid="qr-modal"] img, [data-testid="qr-modal"] [data-testid="spinner"]',
      { timeout: 15000 }
    ).should('exist');
  });

  it('QR modal can be closed / dismissed', () => {
    cy.contains('button', /connect whatsapp|scan qr/i, { timeout: 8000 }).click();
    cy.get('[role="dialog"]', { timeout: 5000 }).should('be.visible');

    // Press Escape to close
    cy.get('body').type('{esc}');
    cy.get('[role="dialog"]').should('not.exist');
  });
});

describe('WhatsApp — Settings page', () => {
  before(() => {
    cy.requireClerkCredentials();
  });

  beforeEach(() => {
    cy.signInWithClerk();
    cy.visit('/settings');
  });

  it('/settings page renders WhatsApp connection card', () => {
    cy.contains(/whatsapp/i, { timeout: 8000 }).should('exist');
  });

  it('shows connection status (connected or disconnected)', () => {
    cy.contains(/connected|disconnected|not connected/i, { timeout: 8000 }).should('exist');
  });

  it('API: GET /api/v1/whatsapp/status returns a valid shape', () => {
    cy.window().then((win: any) => {
      return win.Clerk?.session?.getToken().then((token: string) => {
        if (!token) return;
        cy.request({
          url: '/api/v1/whatsapp/status',
          headers: { Authorization: `Bearer ${token}` },
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.success).to.eq(true);
          expect(res.body.data).to.have.property('status');
        });
      });
    });
  });
});
