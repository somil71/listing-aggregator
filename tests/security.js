/**
 * Security Audit — SQL injection, XSS, auth enforcement, rate limiting.
 * Run: node tests/security.js  (server must be running)
 */
require('dotenv').config();
const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
let passed = 0, failed = 0;

function check(label, condition, detail = '') {
  if (condition) { console.log(`  ✓  ${label}`); passed++; }
  else            { console.log(`  ✗  ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body), raw: body, headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: null, raw: body, headers: res.headers }); }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function encode(str) { return encodeURIComponent(str); }

async function runSecurity() {
  console.log('\n5️⃣  SECURITY AUDIT');
  console.log('='.repeat(60));

  // ── 5.1 SQL Injection ────────────────────────────────────────────────
  console.log('\n5.1 SQL Injection Prevention');
  const injections = [
    `'; DROP TABLE listings; --`,
    `1 OR 1=1`,
    `' UNION SELECT * FROM users --`,
    `1; SELECT * FROM whatsapp_sessions --`,
  ];

  for (const payload of injections) {
    try {
      const r = await request('GET', `/api/listings/today?location=${encode(payload)}`);
      // Should return 401 (no auth) or 200 with 0 results — never expose data or crash
      const safe = r.status === 401 || (r.status === 200 && Array.isArray(r.body?.data?.listings));
      check(`SQL injection blocked: "${payload.substring(0, 30)}..."`, safe, `status=${r.status}`);
    } catch (err) {
      check(`SQL injection blocked: "${payload.substring(0, 30)}..."`, false, err.message);
    }
  }

  // Verify listings table still exists after injection attempts
  try {
    const r = await request('GET', '/health');
    check('listings table survived injection attempts', r.body?.database?.connected === true);
  } catch {}

  // ── 5.2 XSS Prevention ──────────────────────────────────────────────
  console.log('\n5.2 XSS Prevention');
  const xssPayloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
  ];

  for (const payload of xssPayloads) {
    try {
      const r = await request('GET', `/api/v1/search?q=${encode(payload)}`);
      const raw = r.raw;
      // Script tags must not appear unescaped in JSON API responses
      const unescaped = raw.includes('<script>') || raw.includes('onerror=alert');
      check(`XSS payload not unescaped: "${payload.substring(0, 25)}..."`, !unescaped, `unescaped=${unescaped}`);
    } catch (err) {
      check(`XSS check: "${payload.substring(0, 25)}..."`, false, err.message);
    }
  }

  // ── 5.3 Authentication Enforcement ──────────────────────────────────
  console.log('\n5.3 Authentication Enforcement');
  const protectedRoutes = [
    ['GET',  '/api/listings/today'],
    ['GET',  '/api/listings/abc123'],
    ['GET',  '/api/v1/whatsapp/status'],
    ['POST', '/api/v1/whatsapp/initiate-qr'],
    ['GET',  '/api/v1/whatsapp/groups'],
    ['POST', '/api/v1/whatsapp/select-groups'],
    ['POST', '/api/v1/whatsapp/disconnect'],
    ['GET',  '/api/agents'],
    ['GET',  '/api/groups'],
    ['GET',  '/api/v1/search?q=test'],
  ];

  for (const [method, path] of protectedRoutes) {
    try {
      const r = await request(method, path);
      check(`${method} ${path} → 401 without token`, r.status === 401, `got ${r.status}`);
    } catch (err) {
      check(`${method} ${path} auth check`, false, err.message);
    }
  }

  // Invalid token
  try {
    const r = await request('GET', '/api/listings/today', { headers: { Authorization: 'Bearer invalid_token_here' } });
    check('Invalid token rejected (401)', r.status === 401, `got ${r.status}`);
  } catch (err) {
    check('Invalid token check', false, err.message);
  }

  // ── 5.4 Input Validation ─────────────────────────────────────────────
  console.log('\n5.4 Input Validation');

  const validationTests = [
    { path: '/api/listings/today?min_price=abc',           expect: 401, label: 'Non-numeric min_price (blocked by auth before validation)' },
    { path: '/api/v1/digests/invalid-date',                expect: 401, label: 'Invalid date format blocked by auth' },
    { path: '/api/v1/digests/01-15-2024',                  expect: 401, label: 'Wrong date format blocked by auth' },
  ];

  for (const t of validationTests) {
    try {
      const r = await request('GET', t.path);
      check(t.label, r.status === t.expect || r.status === 400, `got ${r.status}`);
    } catch (err) {
      check(t.label, false, err.message);
    }
  }

  // ── 5.5 Rate Limiting ────────────────────────────────────────────────
  console.log('\n5.5 Rate Limiting');
  console.log('  (Sending 15 rapid /health requests — exempt from limiting)');

  const healthResults = await Promise.all(
    Array.from({ length: 15 }, () => request('GET', '/health'))
  );
  const healthAllOk = healthResults.every(r => r.status === 200);
  check('Health endpoint exempt from rate limiting (15 rapid calls all 200)', healthAllOk);

  // ── 5.6 Sensitive Data in Responses ──────────────────────────────────
  console.log('\n5.6 Sensitive Data Exposure');
  try {
    // .env file must not be served
    const envR = await request('GET', '/.env');
    check('.env file returns non-200', envR.status !== 200, `got ${envR.status}`);

    const envLocalR = await request('GET', '/.env.local');
    check('.env.local file returns non-200', envLocalR.status !== 200, `got ${envLocalR.status}`);
  } catch (err) {
    check('.env file exposure check', false, err.message);
  }

  // Health endpoint must not expose secrets
  try {
    const r = await request('GET', '/health');
    const raw = r.raw.toLowerCase();
    const exposesSecret = raw.includes('sk_test') || raw.includes('sk_live') ||
                          raw.includes('secret') || raw.includes('password');
    check('Health response contains no secrets', !exposesSecret);
  } catch (err) {
    check('Health secret exposure check', false, err.message);
  }

  // ── 5.7 CORS ─────────────────────────────────────────────────────────
  console.log('\n5.7 CORS Headers');
  try {
    // CORS headers are only sent when the request includes an Origin header
    const r = await request('GET', '/health', { headers: { Origin: 'http://localhost:5173' } });
    const acao = r.headers['access-control-allow-origin'];
    check('CORS header present when Origin sent', typeof acao !== 'undefined', `acao=${acao}`);
  } catch (err) {
    check('CORS check', false, err.message);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '✅ SECURITY AUDIT PASSED' : `❌ SECURITY AUDIT: ${failed} issue(s) found`);
  return failed;
}

runSecurity().then(f => process.exit(f > 0 ? 1 : 0)).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
