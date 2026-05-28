/**
 * E2E — API Health & Public Endpoints
 * These tests run against the live server (no auth required).
 * Server must be running at baseUrl (default: http://localhost:3000).
 */

describe('API Health', () => {
  it('GET /health returns 200 with expected shape', () => {
    cy.request('/health').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.success).to.eq(true);
      expect(res.body.status).to.eq('healthy');
      expect(res.body.database.connected).to.eq(true);
      expect(res.body.uptime).to.be.greaterThan(0);
      expect(res.body.memory.heap_used_mb).to.be.lessThan(500);
    });
  });

  it('GET /health responds in < 500 ms', () => {
    const start = Date.now();
    cy.request('/health').then(() => {
      expect(Date.now() - start).to.be.lessThan(500);
    });
  });

  it('GET /api/v1/nonexistent returns 404 with success:false', () => {
    cy.request({ url: '/api/v1/nonexistent', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.eq(404);
      expect(res.body.success).to.eq(false);
      expect(res.body.error).to.be.a('string');
    });
  });

  it('Protected endpoint returns 401 without a token', () => {
    cy.request({ url: '/api/listings/today', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.eq(401);
    });
  });

  it('.env file is NOT served (must return non-200)', () => {
    cy.request({ url: '/.env', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.not.eq(200);
    });
  });
});
