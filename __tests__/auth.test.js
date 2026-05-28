// Unit tests for the SSE nonce flow in src/api/middleware/auth.js.
// Uses in-memory fallback (no Redis) so the test runs offline.

jest.mock('../src/api/services/cacheService', () => ({
  _redisReady: false,
  _redis: null,
}));

jest.mock('@clerk/backend', () => ({
  createClerkClient: () => ({}),
  verifyToken: jest.fn(),
}));

const { createSSENonce, authenticateSSE } = require('../src/api/middleware/auth');

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('SSE nonce middleware', () => {
  test('createSSENonce returns a unique opaque string', async () => {
    const a = await createSSENonce('user-1');
    const b = await createSSENonce('user-1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{40}$/);
  });

  test('authenticateSSE accepts a valid nonce once, then rejects on reuse', async () => {
    const nonce = await createSSENonce('user-7');
    const req1 = { query: { token: nonce } };
    const res1 = mockResponse();
    const next1 = jest.fn();
    await authenticateSSE(req1, res1, next1);
    expect(next1).toHaveBeenCalled();
    expect(req1.userId).toBe('user-7');

    // Second use of the same nonce must be rejected
    const req2 = { query: { token: nonce } };
    const res2 = mockResponse();
    const next2 = jest.fn();
    await authenticateSSE(req2, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(401);
    expect(next2).not.toHaveBeenCalled();
  });

  test('authenticateSSE rejects malformed tokens', async () => {
    const cases = [undefined, '', 'short', 'a'.repeat(200)];
    for (const token of cases) {
      const req = { query: { token } };
      const res = mockResponse();
      const next = jest.fn();
      await authenticateSSE(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('authenticateSSE rejects unknown nonces', async () => {
    const req = { query: { token: 'a'.repeat(40) } };
    const res = mockResponse();
    const next = jest.fn();
    await authenticateSSE(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
