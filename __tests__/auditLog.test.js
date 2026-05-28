// Verifies the audit log middleware:
//   - Skips logging for 4xx responses
//   - Uses req.socket.remoteAddress (NOT spoofable x-forwarded-for)
//   - Fire-and-forget — never blocks the response

const mockQuery = jest.fn(() => Promise.resolve({ rows: [] }));
jest.mock('../src/db/postgres/pool', () => ({
  query: mockQuery,
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const auditLog = require('../src/api/middleware/auditLog');

function mockResAndRun(req, statusCode = 200) {
  const handlers = {};
  const res = {
    statusCode,
    on: (event, cb) => { handlers[event] = cb; },
  };
  const next = jest.fn();
  const mw = auditLog('test_action', 'test_resource');
  mw(req, res, next);
  expect(next).toHaveBeenCalled();
  if (handlers.finish) handlers.finish();
}

describe('auditLog middleware', () => {
  beforeEach(() => mockQuery.mockClear());

  test('logs successful actions to Postgres', () => {
    mockResAndRun({
      userId: 'user_abc',
      params: { id: 'r-123' },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
      get: () => 'curl/8.0',
    }, 200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe('test_action');
    expect(params[3]).toBe('user_abc');
    const metadata = JSON.parse(params[2]);
    expect(metadata.resourceId).toBe('r-123');
    expect(metadata.ip).toBe('10.0.0.1');
  });

  test('does NOT log 4xx/5xx responses', () => {
    mockResAndRun({
      userId: 'user_x',
      socket: { remoteAddress: '1.2.3.4' },
      get: () => 'ua',
    }, 401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('IP comes from socket only — x-forwarded-for is ignored', () => {
    mockResAndRun({
      userId: 'user_x',
      socket: { remoteAddress: 'real-ip' },
      headers: { 'x-forwarded-for': 'spoofed-ip' },
      get: () => 'ua',
    }, 200);
    const metadata = JSON.parse(mockQuery.mock.calls[0][1][2]);
    expect(metadata.ip).toBe('real-ip');
  });
});
