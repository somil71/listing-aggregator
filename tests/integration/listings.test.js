const request = require('supertest');
const app = require('../../src/api/server');
const { getConnection } = require('../../src/db/connection');

describe('Listings API Integration', () => {
  let db;

  beforeAll(async () => {
    db = getConnection();
    await db.connect();
    
    // Seed real schema for testing
    const fs = require('fs');
    const path = require('path');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8');
    
    // db.run only executes the first statement, we need to run all statements
    const statements = schemaSql.split(';').filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
  });

  afterAll(async () => {
    await db.close();
  });

  describe('GET /api/v1/listings/today', () => {
    it('should return 200 with formatted response', async () => {
      const response = await request(app).get('/api/v1/listings/today');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('listings');
      expect(response.body.data).toHaveProperty('pagination');
      expect(response.body.data).toHaveProperty('statistics');
    });

    it('should validate min_price > max_price', async () => {
      const response = await request(app).get('/api/v1/listings/today?min_price=2000&max_price=1000');
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_PRICE_RANGE');
    });
  });
});
