// Unit tests for the circuit breaker — verifies state transitions, recovery,
// and the HALF_OPEN race fix landed in Phase 3.

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { CircuitBreaker } = require('../src/api/middleware/circuitBreaker');

describe('CircuitBreaker', () => {
  test('starts CLOSED and forwards return values', async () => {
    const cb = new CircuitBreaker('test', 3, 100);
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.status().state).toBe('CLOSED');
  });

  test('opens after threshold consecutive failures', async () => {
    const cb = new CircuitBreaker('test', 3, 100);
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    }
    expect(cb.status().state).toBe('OPEN');

    // Once OPEN, calls fail-fast with CIRCUIT_OPEN
    await expect(cb.execute(async () => 1)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
  });

  test('transitions OPEN → HALF_OPEN → CLOSED on successful probe', async () => {
    const cb = new CircuitBreaker('test', 2, 50);
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute(async () => { throw new Error('boom'); })).rejects.toThrow();
    }
    expect(cb.status().state).toBe('OPEN');

    // Wait past the cool-off window
    await new Promise(r => setTimeout(r, 60));
    const result = await cb.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.status().state).toBe('CLOSED');
  });

  test('HALF_OPEN race — only first concurrent caller probes', async () => {
    const cb = new CircuitBreaker('test', 1, 30);
    await expect(cb.execute(async () => { throw new Error('boom'); })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 40));

    let probedCount = 0;
    const slowFn = async () => {
      probedCount++;
      await new Promise(r => setTimeout(r, 50));
      return 'ok';
    };

    // Fire 10 concurrent calls — only one should actually call slowFn,
    // the rest should fast-fail with CIRCUIT_OPEN.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => cb.execute(slowFn))
    );
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected  = results.filter(r => r.status === 'rejected').length;

    expect(probedCount).toBe(1);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(9);
  });

  test('records failure timestamp', async () => {
    const cb = new CircuitBreaker('test', 1, 1000);
    const before = Date.now();
    await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.lastFailureTime).toBeGreaterThanOrEqual(before);
  });

  test('CIRCUIT_OPEN errors do not increment failure count', async () => {
    const cb = new CircuitBreaker('test', 1, 10_000);
    await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.failureCount).toBe(1);
    // Further calls fail with CIRCUIT_OPEN but don't compound
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(async () => 1)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    }
    expect(cb.failureCount).toBe(1);
  });
});
