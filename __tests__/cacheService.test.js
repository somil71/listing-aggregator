// Unit tests for CacheService — exercises the in-memory fallback path
// (no Redis env required). Verifies TTL expiry, eviction sweep, and stats.

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const cacheService = require('../src/api/services/cacheService');

// Force the in-memory path even if REDIS_URL happens to be set
cacheService._redisReady = false;

describe('CacheService (in-memory fallback)', () => {
  beforeEach(() => {
    cacheService._store.clear();
    cacheService._hits = 0;
    cacheService._misses = 0;
  });

  test('get returns null on miss', async () => {
    expect(await cacheService.get('missing')).toBeNull();
    expect(cacheService.stats().misses).toBe(1);
  });

  test('set and get round-trips JSON-serialisable values', async () => {
    await cacheService.set('k1', { a: 1, b: [2, 3] }, 1000);
    const v = await cacheService.get('k1');
    expect(v).toEqual({ a: 1, b: [2, 3] });
    expect(cacheService.stats().hits).toBe(1);
  });

  test('honours TTL expiry', async () => {
    await cacheService.set('k1', 'v1', 30);
    await new Promise(r => setTimeout(r, 60));
    expect(await cacheService.get('k1')).toBeNull();
  });

  test('invalidate removes matching keys', async () => {
    await cacheService.set('listings:abc', 1, 10_000);
    await cacheService.set('listings:def', 2, 10_000);
    await cacheService.set('other:abc',    3, 10_000);
    const removed = await cacheService.invalidate('listings:');
    expect(removed).toBe(2);
    expect(await cacheService.get('listings:abc')).toBeNull();
    expect(await cacheService.get('other:abc')).toBe(3);
  });

  test('hit rate calculation', async () => {
    await cacheService.set('hit', 'x', 10_000);
    await cacheService.get('hit');
    await cacheService.get('hit');
    await cacheService.get('miss');
    const stats = cacheService.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe('66.7%');
  });

  test('eviction sweeps expired entries', async () => {
    await cacheService.set('expire-me', 1, 10);
    await new Promise(r => setTimeout(r, 30));
    cacheService._evict();
    expect(cacheService._store.has('expire-me')).toBe(false);
  });
});
