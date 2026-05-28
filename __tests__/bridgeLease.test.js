// Unit tests for distributed bridge ownership lease.
// Uses the in-memory fallback path so no Redis is required.

jest.mock('../src/api/services/cacheService', () => ({
  _redisReady: false,
  _redis: null,
}));

const bridgeLease = require('../src/api/services/bridgeLease');

describe('bridgeLease (in-memory mode)', () => {
  beforeEach(() => {
    // Reset internal Map state
    bridgeLease._memLeases?.clear?.();
  });

  test('acquire grants ownership when free', async () => {
    const result = await bridgeLease.acquire('user1');
    expect(result.acquired).toBe(true);
    expect(result.ownerId).toBe(bridgeLease.INSTANCE_ID);
  });

  test('refresh extends an existing lease', async () => {
    await bridgeLease.acquire('user1');
    const ok = await bridgeLease.refresh('user1');
    expect(ok).toBe(true);
  });

  test('release frees the lease so another caller can acquire', async () => {
    await bridgeLease.acquire('user1');
    await bridgeLease.release('user1');
    const result = await bridgeLease.acquire('user1');
    expect(result.acquired).toBe(true);
  });

  test('release is idempotent', async () => {
    await bridgeLease.acquire('user1');
    await bridgeLease.release('user1');
    await expect(bridgeLease.release('user1')).resolves.not.toThrow();
  });

  test('startRefresh + stopRefresh manage the background timer', async () => {
    await bridgeLease.acquire('user1');
    const stop = bridgeLease.startRefresh('user1');
    expect(typeof stop).toBe('function');
    bridgeLease.stopRefresh('user1');
  });
});
