/**
 * Endpoint Connection Tests — verifies all API routes respond correctly.
 * Run: node tests/endpoints.js  (server must be running)
 * Note: Protected endpoints are tested for 401 (auth required).
 *       To test with a real token: TOKEN=<clerk_jwt> node tests/endpoints.js
 */
require('dotenv').config();
const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const TOKEN = process.env.TOKEN || null;
let passed = 0, failed = 0;

function check(label, condition, detail = '') {
  if (condition) { console.log(`  ✓  ${label}`); passed++; }
  else            { console.log(`  ✗  ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    if (opts.headers) Object.assign(headers, opts.headers);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 8000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body), raw: body, ms: Date.now() }); }
        catch { resolve({ status: res.statusCode, body: null, raw: body, ms: Date.now() }); }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (opts.data) req.write(JSON.stringify(opts.data));
    req.end();
  });
}

function expectAuthOrOk(r) {
  return TOKEN ? r.status === 200 : r.status === 401;
}

async function runEndpoints() {
  const authMode = TOKEN ? 'with token' : 'unauthenticated (expect 401 on protected routes)';
  console.log(`\n2️⃣  ENDPOINT TESTS  [${authMode}]`);
  console.log('='.repeat(60));

  // ── 2.1 Health ───────────────────────────────────────────────────────
  console.log('\n2.1 Health & Public Routes');
  // Hardened contract: /health returns the minimal { success, status:'ok' }
  // (no database/uptime detail — that leaked deployment info). Mirrors smoke.js.
  const h = await request('GET', '/health').catch(() => null);
  check('GET /health → 200',          h?.status === 200);
  check('body.success === true',       h?.body?.success === true);
  check("body.status === 'ok'",        h?.body?.status === 'ok');
  check('no internal detail leaked',   h?.body?.database === undefined && h?.body?.uptime === undefined);

  // ── 2.2 Listings ─────────────────────────────────────────────────────
  console.log('\n2.2 Listings Endpoints');

  const today = await request('GET', '/api/listings/today').catch(() => null);
  check(`GET /api/listings/today → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(today));
  if (TOKEN && today?.body) {
    check('response.data.listings is array', Array.isArray(today.body?.data?.listings));
    check('response.data.pagination exists', typeof today.body?.data?.pagination === 'object');
    check('response.data.statistics exists', typeof today.body?.data?.statistics === 'object');
  }

  const filtered = await request('GET', '/api/listings/today?location=Bandra&min_price=1000000&max_price=50000000').catch(() => null);
  check(`GET /listings/today?location= → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(filtered));

  const badPrice = await request('GET', '/api/listings/today?min_price=abc').catch(() => null);
  check('GET /listings/today?min_price=abc → 400 or 401',
        badPrice?.status === 400 || badPrice?.status === 401);

  const invertedPrice = await request('GET', '/api/listings/today?min_price=50000000&max_price=1000000').catch(() => null);
  check('min > max price → 400 or 401',
        invertedPrice?.status === 400 || invertedPrice?.status === 401);

  const single = await request('GET', '/api/listings/NONEXISTENT_ID').catch(() => null);
  check('GET /api/listings/:id missing → 401 or 404',
        single?.status === 401 || single?.status === 404);

  // ── 2.3 Search ───────────────────────────────────────────────────────
  console.log('\n2.3 Search Endpoint');
  const search = await request('GET', '/api/v1/search?q=3bhk').catch(() => null);
  check(`GET /api/v1/search?q=3bhk → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(search));

  const emptySearch = await request('GET', '/api/v1/search?q=').catch(() => null);
  check('GET /api/v1/search?q= → 400 or 401',
        emptySearch?.status === 400 || emptySearch?.status === 401);

  // ── 2.4 Agents & Groups ──────────────────────────────────────────────
  console.log('\n2.4 Agent & Group Endpoints');
  const agents = await request('GET', '/api/agents').catch(() => null);
  check(`GET /api/agents → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(agents));

  const groups = await request('GET', '/api/groups').catch(() => null);
  check(`GET /api/groups → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(groups));

  // ── 2.5 WhatsApp Routes ──────────────────────────────────────────────
  console.log('\n2.5 WhatsApp Routes (auth required)');
  const waStatus = await request('GET', '/api/v1/whatsapp/status').catch(() => null);
  check(`GET /api/v1/whatsapp/status → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(waStatus));

  const waGroups = await request('GET', '/api/v1/whatsapp/groups').catch(() => null);
  check(`GET /api/v1/whatsapp/groups → ${TOKEN ? 200 : 401}`, expectAuthOrOk(waGroups));

  const waInit = await request('POST', '/api/v1/whatsapp/initiate-qr').catch(() => null);
  check(`POST /api/v1/whatsapp/initiate-qr → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(waInit));

  const waSelect = await request('POST', '/api/v1/whatsapp/select-groups', {
    data: { groupIds: [], groupNames: [] }
  }).catch(() => null);
  check(`POST /api/v1/whatsapp/select-groups (empty) → 400 or 401`,
        waSelect?.status === 400 || waSelect?.status === 401);

  const waDisc = await request('POST', '/api/v1/whatsapp/disconnect').catch(() => null);
  check(`POST /api/v1/whatsapp/disconnect → ${TOKEN ? '200' : '401'}`, expectAuthOrOk(waDisc));

  // ── 2.6 Digest ───────────────────────────────────────────────────────
  console.log('\n2.6 Digest Endpoints');
  const digestGood = await request('GET', '/api/v1/digests/2025-01-01').catch(() => null);
  check('GET /api/v1/digests/2025-01-01 → 401 or 200 or 404',
        [200, 401, 404].includes(digestGood?.status));

  const digestBad = await request('GET', '/api/v1/digests/invalid').catch(() => null);
  check('GET /api/v1/digests/invalid → 400 or 401',
        digestBad?.status === 400 || digestBad?.status === 401);

  // ── 2.7 Error Responses ──────────────────────────────────────────────
  console.log('\n2.7 Error Response Shapes');
  const notFound = await request('GET', '/api/v1/does_not_exist').catch(() => null);
  check('GET /api/v1/nonexistent → 404', notFound?.status === 404);
  check('404 body has success:false',     notFound?.body?.success === false);
  check('404 body has error field',       typeof notFound?.body?.error === 'string');

  const noAuth = await request('GET', '/api/listings/today', { headers: { Authorization: '' } }).catch(() => null);
  check('Missing auth → 401', noAuth?.status === 401);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (!TOKEN) console.log('\n💡 Run with TOKEN=<clerk_jwt> to test authenticated responses.');
  console.log(failed === 0 ? '✅ ENDPOINT TESTS PASSED' : `❌ ENDPOINT TESTS: ${failed} failure(s)`);
  return failed;
}

runEndpoints().then(f => process.exit(f > 0 ? 1 : 0)).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
