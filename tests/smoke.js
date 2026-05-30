/**
 * Smoke Test — verifies the server starts and basic endpoints respond.
 * Run: node tests/smoke.js  (server must be running on PORT 3000)
 */
require('dotenv').config();
const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
let passed = 0, failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.log(`  ✗  ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function get(path, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body), raw: body }); }
        catch { resolve({ status: res.statusCode, body: null, raw: body }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

async function runSmoke() {
  console.log('\n1️⃣  SMOKE TESTS');
  console.log('='.repeat(60));

  // 1.1 Health endpoint — hardened contract: minimal { success, status:'ok' }.
  // Verbose fields (database/memory/uptime) were intentionally removed so the
  // public health endpoint can't be used to fingerprint internals. A 200 here
  // already proves DB connectivity: /health runs `SELECT 1` and returns 503 if
  // the database is unreachable (see src/api/server.js). Internal observability
  // lives on the token-gated /api/v1/metrics endpoint instead.
  console.log('\n1.1 Health Endpoint');
  try {
    const t0 = Date.now();
    const r = await get('/health');
    const ms = Date.now() - t0;

    check('Status 200 (implies DB reachable)', r.status === 200);
    check('Response < 500ms',     ms < 500, `${ms}ms`);
    check('success: true',        r.body?.success === true);
    check('status: ok',           r.body?.status === 'ok');
  } catch (err) {
    check('Health endpoint reachable', false, err.message);
  }

  // 1.2 404 on /api/nonexistent
  console.log('\n1.2 404 Handler');
  try {
    const r = await get('/api/v1/nonexistent');
    check('Status 404',           r.status === 404);
    check('success: false',       r.body?.success === false);
    check('error field present',  typeof r.body?.error === 'string');
  } catch (err) {
    check('404 handler works', false, err.message);
  }

  // 1.3 Auth required on /api/listings/today
  console.log('\n1.3 Auth Enforcement');
  try {
    const r = await get('/api/listings/today');
    check('Status 401 without token', r.status === 401);
  } catch (err) {
    check('Auth check reachable', false, err.message);
  }

  // 1.4 Auth required on /api/v1/whatsapp/status
  try {
    const r = await get('/api/v1/whatsapp/status');
    check('WhatsApp status 401 without token', r.status === 401);
  } catch (err) {
    check('WhatsApp auth check reachable', false, err.message);
  }

  // 1.5 Static SPA fallback
  console.log('\n1.4 Static Files');
  try {
    const r = await get('/');
    check('SPA index.html served (200)', r.status === 200);
    check('Contains HTML',              r.raw.includes('<!DOCTYPE') || r.raw.includes('<html'));
  } catch (err) {
    check('Static files reachable', false, err.message);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '✅ ALL SMOKE TESTS PASSED' : '❌ SOME SMOKE TESTS FAILED');
  return failed;
}

runSmoke().then(f => process.exit(f > 0 ? 1 : 0)).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
