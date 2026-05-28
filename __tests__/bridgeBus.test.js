// Unit tests for the bridge event bus — HMAC signing, in-memory fallback.

jest.mock('../src/api/services/cacheService', () => ({
  _redisReady: false,
  _redis: null,
}));

process.env.BRIDGE_HMAC_SECRET = 'test-secret-for-deterministic-signatures';

const bridgeBus = require('../src/api/services/bridgeBus');

describe('bridgeBus (in-memory fallback)', () => {
  test('subscribe receives published events for the same user', async () => {
    const received = [];
    const unsub = bridgeBus.subscribeEvents('user-A', (evt) => received.push(evt));
    await bridgeBus.publishEvent('user-A', { type: 'qr', data: { url: 'x' }, ts: 1 });
    await bridgeBus.publishEvent('user-A', { type: 'ready', data: {}, ts: 2 });
    expect(received).toHaveLength(2);
    expect(received[0].type).toBe('qr');
    expect(received[1].type).toBe('ready');
    unsub();
  });

  test('events are NOT delivered cross-user', async () => {
    const aEvents = [];
    const bEvents = [];
    const unA = bridgeBus.subscribeEvents('user-A', e => aEvents.push(e));
    const unB = bridgeBus.subscribeEvents('user-B', e => bEvents.push(e));
    await bridgeBus.publishEvent('user-A', { type: 'qr', ts: 1 });
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(0);
    unA(); unB();
  });

  test('receiveCommands fires for sendCommand on the same userId', async () => {
    const received = [];
    const unsub = bridgeBus.receiveCommands('user-X', (cmd) => received.push(cmd));
    await bridgeBus.sendCommand('user-X', { cmd: 'disconnect', ts: Date.now() });
    expect(received).toHaveLength(1);
    expect(received[0].cmd).toBe('disconnect');
    unsub();
  });

  test('isDistributed returns false without Redis', () => {
    expect(bridgeBus.isDistributed()).toBe(false);
  });
});
