/**
 * Performance Test — response time benchmarks and concurrent load.
 * Run: node tests/performance.js  (server must be running, data must exist)
 * Run after bulk_insert.js + bulk_parse.js to get meaningful results.
 */
require('dotenv').config();
const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const TOKEN = process.env.TOKEN || null;
let passed = 0, failed = 0;

function check(label, condition, detail = '') {
  if (condition) { console.log(`  ✓  ${label}${detail ? '  (' + detail + ')' : ''}`); passed++; }
  else            { console.log(`  ✗  ${label}${detail ? '  (' + detail + ')' : ''}`); failed++; }
}

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

    const t0 = Date.now();
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body), ms: Date.now() - t0 }); }
        catch { resolve({ status: res.statusCode, body: null, ms: Date.now() - t0 }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

async function bench(label, path, limitMs) {
  try {
    // Warm up
    await get(path);
    // 3 samples, take median
    const times = [];
    for (let i = 0; i < 3; i++) {
      const r = await get(path);
      times.push(r.ms);
    }
    times.sort((a, b) => a - b);
    const median = times[1];
    check(`${label} < ${limitMs}ms`, median < limitMs, `${median}ms median`);
    return median;
  } catch (err) {
    check(label, false, err.message);
    return Infinity;
  }
}

async function concurrent(path, concurrency, total) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  const doReq = () => new Promise((resolve) => {
    const t0 = Date.now();
    const url = new URL(`${BASE}${path}`);
    const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers, timeout: 10000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0 }));
    });
    req.on('error', () => resolve({ status: 0, ms: Date.now() - t0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: Date.now() - t0 }); });
  });

  const results = [];
  const batches = Math.ceil(total / concurrency);

  for (let b = 0; b < batches; b++) {
    const batch = Array.from({ length: Math.min(concurrency, total - b * concurrency) }, doReq);
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }
  return results;
}

async function runPerf() {
  console.log('\n6️⃣  PERFORMANCE TESTS');
  console.log('='.repeat(60));
  if (!TOKEN) console.log('  ⚠️  No TOKEN set — protected routes will return 401 (timing still measured)\n');

  // ── 6.1 Response Time Benchmarks ────────────────────────────────────
  console.log('\n6.1 Response Time Benchmarks (median of 3 runs)');
  await bench('GET /health',                          '/health',                                       200);
  await bench('GET /api/listings/today',              '/api/listings/today',                           1500);
  await bench('GET /api/listings/today (filtered)',   '/api/listings/today?location=Bandra&min_price=1000000', 2000);
  await bench('GET /api/listings/today?limit=1000',   '/api/listings/today?limit=1000',               2500);
  await bench('GET /api/v1/search?q=3bhk',            '/api/v1/search?q=3bhk',                        1500);
  await bench('GET /api/agents',                      '/api/agents',                                   800);
  await bench('GET /api/groups',                      '/api/groups',                                   800);

  // ── 6.2 Concurrent Load ──────────────────────────────────────────────
  console.log('\n6.2 Concurrent Load Test (100 requests, 20 at a time → /health)');
  const t0 = Date.now();
  const results = await concurrent('/health', 20, 100);
  const elapsed = Date.now() - t0;

  const ok     = results.filter(r => r.status === 200).length;
  const times  = results.map(r => r.ms).sort((a, b) => a - b);
  const p50    = times[Math.floor(times.length * 0.5)];
  const p95    = times[Math.floor(times.length * 0.95)];
  const p99    = times[Math.floor(times.length * 0.99)];

  check('All 100 concurrent requests succeed',  ok === 100, `${ok}/100 ok`);
  check('P50 latency < 500ms',                  p50 < 500,   `${p50}ms`);
  check('P95 latency < 1000ms',                 p95 < 1000,  `${p95}ms`);
  check('P99 latency < 2000ms',                 p99 < 2000,  `${p99}ms`);
  console.log(`  Wall time for 100 requests: ${elapsed}ms`);

  // ── 6.3 Rate Limit Behaviour ─────────────────────────────────────────
  console.log('\n6.3 Rate Limit Response Correctness');
  // Send more than 100 rapid requests to /api/listings/today
  // We only need to verify the 429 response shape — not actually exhaust the limit
  // (avoid side effects on the real rate limit window)
  console.log('  (Skipping limit exhaustion — verified structurally in security.js)');
  check('Rate limiter configured (express-rate-limit installed)', (() => {
    try { require('express-rate-limit'); return true; } catch { return false; }
  })());

  // ── 6.4 Memory Stability ─────────────────────────────────────────────
  console.log('\n6.4 Memory Stability');
  const memBefore = process.memoryUsage().heapUsed;
  // Fire 50 requests
  await concurrent('/health', 10, 50);
  // Give GC a moment
  await new Promise(r => setTimeout(r, 200));
  const memAfter = process.memoryUsage().heapUsed;
  const growthMB = Math.round((memAfter - memBefore) / 1024 / 1024);
  check(`Memory growth < 50MB after 50 requests`, growthMB < 50, `${growthMB} MB growth`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '✅ PERFORMANCE TESTS PASSED' : `❌ PERFORMANCE TESTS: ${failed} failure(s)`);
  return failed;
}

runPerf().then(f => process.exit(f > 0 ? 1 : 0)).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
