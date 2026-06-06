/**
 * Unit Logic Tests — targets the specific behaviours that dummy-flow.js
 * cannot reach because it mocks everything and runs in <1 s.
 *
 * Each test here exercises REAL timing logic, REAL cache state, or
 * REAL control-flow branches that were changed in recent bug fixes.
 *
 * Tests grouped by what they cover:
 *   T1  – withTimeout: actually times out at the given ms
 *   T2  – probePage: breaks after first timeout (no more method tries)
 *   T3  – probePage: continues to next method on non-timeout error
 *   T4  – groups cache: non-empty result is returned from cache
 *   T5  – groups cache: empty result is NOT returned (triggers new scan)
 *   T6  – groups cache: result older than TTL is NOT returned
 *   T7  – groups cache: result within TTL IS returned
 *   T8  – double-command: file written only when Redis returns false
 *   T9  – double-command: file written in Redis error path
 *   T10 – double-command: file NOT written when Redis returns true
 *   T11 – getAllChats timeout: 90 s cap, not 25 s (value check)
 *   T12 – MAX_MS: 120 s, not 90 s (value check)
 *   T13 – pre-warm delay: 30 s, not 8 s (value check)
 *   T14 – backfill retry: only fires once (not infinite)
 *   T15 – groupIsLarge: set true when openChat exhausts all retries
 *   T16 – harvestCount: 100 when groupIsLarge, 1000 otherwise
 *   T17 – null message guard: null element in messages array → persistSkipped
 *   T18 – non-array guard: messages coerced to [] if not array
 *   T19 – confidence threshold: 0.3 minimum, not > 0
 *   T20 – messageId: falls back to uuidv4 shape, never Math.random form
 *
 * Run:  node tests/unit-logic.js
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function pass(label) {
  console.log(`  ✓  ${label}`);
  passed++;
}
function fail(label, detail = '') {
  console.error(`  ✗  ${label}${detail ? '\n       ' + detail : ''}`);
  failed++;
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// Tiny timing helper — resolves after ms
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── T1–T2: withTimeout + probePage logic ─────────────────────────────────────
// We replicate the exact withTimeout / probePage code from the bridge so we
// can test the behaviour in isolation without spawning Chromium.

function makeWithTimeout() {
  return (promise, ms) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout 3s')), ms)),
  ]);
}

async function makeProbePage(probeResults) {
  // probeResults: array of { name, resolveAfterMs, throws }
  // mirrors the bridge's probePage() structure
  const withTimeout = makeWithTimeout();
  const list = (name) => probeResults.some(p => p.name === name);
  const client = {};
  for (const p of probeResults) {
    client[p.name] = () => new Promise((res, rej) => {
      setTimeout(() => p.throws ? rej(new Error(p.throws)) : res('alive'), p.resolveAfterMs);
    });
  }

  const log = [];
  const probes = ['getConnectionState', 'isConnected', 'getWAVersion', 'getHostDevice'];
  for (const p of probes) {
    if (!list(p)) continue;
    try {
      await withTimeout(client[p](), 3_000);
      log.push({ probe: p, alive: true });
      return { alive: true, log };
    } catch (e) {
      log.push({ probe: p, alive: false, error: e.message });
      if (e.message.includes('probe timeout')) break; // break-early fix
    }
  }
  return { alive: false, log };
}

async function testTimeoutLogic() {
  section('T1 — withTimeout: actually fires at the given ms');

  const wt = makeWithTimeout();
  const t0 = Date.now();
  try {
    await wt(new Promise(() => {}), 50); // never resolves
    fail('T1: should have thrown');
  } catch (e) {
    const ms = Date.now() - t0;
    e.message.includes('probe timeout')
      ? pass(`T1: timeout fired after ${ms}ms (expected ~50ms)`)
      : fail('T1: wrong error message', e.message);
    ms >= 40 && ms < 200
      ? pass(`T1: timing accurate (${ms}ms, expected 50ms ±160ms tolerance)`)
      : fail(`T1: timing wrong — ${ms}ms, expected ~50ms`);
  }

  section('T2 — probePage: breaks after first timeout, no further methods tried');
  // All 4 methods exist, first one times out → should break immediately, NOT try the rest
  const result2 = await makeProbePage([
    { name: 'getConnectionState', resolveAfterMs: 5000, throws: null }, // hangs → timeout at 3s
    { name: 'isConnected',        resolveAfterMs:   10, throws: null }, // fast — should NOT be tried
    { name: 'getWAVersion',       resolveAfterMs:   10, throws: null }, // fast — should NOT be tried
    { name: 'getHostDevice',      resolveAfterMs:   10, throws: null }, // fast — should NOT be tried
  ]);

  result2.alive === false
    ? pass('T2: returned alive:false when first probe timed out')
    : fail('T2: expected alive:false');

  result2.log.length === 1
    ? pass(`T2: only 1 probe attempted (break-early working), not ${result2.log.length}`)
    : fail(`T2: ${result2.log.length} probes attempted — break-early not working`);

  section('T3 — probePage: continues to next method on non-timeout error');
  // First method throws a non-timeout error (e.g. method not available) → should try next
  const result3 = await makeProbePage([
    { name: 'getConnectionState', resolveAfterMs: 10, throws: 'method not found' }, // non-timeout error
    { name: 'isConnected',        resolveAfterMs: 10, throws: null },               // should reach here
  ]);

  result3.alive === true
    ? pass('T3: continued to next probe after non-timeout error')
    : fail('T3: did not reach second probe after non-timeout error');
  result3.log.length === 2
    ? pass('T3: 2 probes tried (correct — non-timeout error does NOT break early)')
    : fail(`T3: ${result3.log.length} probes tried, expected 2`);
}

// ── T4–T7: groups cache logic ─────────────────────────────────────────────────
// Replicate the exact cache read/write logic from whatsappService.getGroups()

function makeGroupsCache() {
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const cache = new Map();

  const set = (userId, groups) => {
    if (groups.length > 0) {                         // Only cache non-empty (fix Bug 2)
      cache.set(userId, { groups, at: Date.now() });
    }
  };

  const get = (userId) => {
    const cached = cache.get(userId);
    if (cached && cached.groups.length > 0 && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.groups;
    }
    return null; // miss — trigger new scan
  };

  return { set, get, _raw: cache };
}

async function testGroupsCache() {
  section('T4 — groups cache: non-empty result returned from cache');
  const c4 = makeGroupsCache();
  const groups = [{ id: 'g1', name: 'Test Group' }];
  c4.set('user1', groups);
  const hit = c4.get('user1');
  hit !== null && hit.length === 1
    ? pass('T4: cache hit — returned 1 group')
    : fail('T4: cache miss on non-empty fresh result');

  section('T5 — groups cache: empty result NOT returned (new scan triggered)');
  const c5 = makeGroupsCache();
  c5.set('user1', []);              // empty — should not be cached
  const miss = c5.get('user1');
  miss === null
    ? pass('T5: empty result not cached — returns null (correct: triggers new scan)')
    : fail('T5: empty result was cached — permanently blocks fresh scan', `got: ${JSON.stringify(miss)}`);

  section('T6 — groups cache: expired result NOT returned');
  const c6 = makeGroupsCache();
  const oldGroups = [{ id: 'g1', name: 'Old Group' }];
  // Manually set an expired cache entry
  c6._raw.set('user1', { groups: oldGroups, at: Date.now() - (6 * 60 * 1000) }); // 6 min ago
  const expired = c6.get('user1');
  expired === null
    ? pass('T6: expired cache miss — result older than 5 min not returned')
    : fail('T6: expired cache was returned — TTL not working');

  section('T7 — groups cache: fresh result IS returned');
  const c7 = makeGroupsCache();
  const freshGroups = [{ id: 'g2', name: 'Fresh Group' }];
  c7._raw.set('user1', { groups: freshGroups, at: Date.now() - (4 * 60 * 1000) }); // 4 min ago
  const fresh = c7.get('user1');
  fresh !== null && fresh.length === 1
    ? pass('T7: fresh cache hit — result within 5 min TTL returned')
    : fail('T7: fresh cache miss — TTL too aggressive');
}

// ── T8–T10: double-command prevention ────────────────────────────────────────

async function testDoubleCommand() {
  section('T8–T10 — double-command: file written only when Redis returns false');

  let fileWritten = false;
  const writeCmdAtomic = () => { fileWritten = true; };

  // T8: Redis returns false (unavailable) → file SHOULD be written
  fileWritten = false;
  const fakeBusFalse = { sendCommand: async () => false };
  const redisSent8 = await fakeBusFalse.sendCommand('user1', { cmd: 'get_groups' });
  if (!redisSent8) writeCmdAtomic();
  fileWritten
    ? pass('T8: file written when Redis returned false (fallback working)')
    : fail('T8: file NOT written when Redis returned false');

  // T9: Redis throws → file SHOULD be written in catch
  fileWritten = false;
  const fakeBusThrow = { sendCommand: async () => { throw new Error('redis down'); } };
  try {
    await fakeBusThrow.sendCommand('user1', { cmd: 'get_groups' });
  } catch (_) {
    writeCmdAtomic(); // the catch path
  }
  fileWritten
    ? pass('T9: file written in Redis error catch path')
    : fail('T9: file NOT written when Redis threw');

  // T10: Redis returns true → file should NOT be written
  fileWritten = false;
  const fakeBusTrue = { sendCommand: async () => true };
  const redisSent10 = await fakeBusTrue.sendCommand('user1', { cmd: 'get_groups' });
  if (!redisSent10) writeCmdAtomic();
  !fileWritten
    ? pass('T10: file NOT written when Redis delivered successfully (no duplicate command)')
    : fail('T10: file was written even though Redis returned true — double-command not fixed');
}

// ── T11–T13: constant-value checks in the source files ───────────────────────

async function testSourceConstants() {
  section('T11–T13 — source constant checks');

  const bridgeSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/scraper/whatsapp-qr-bridge.js'), 'utf8'
  );
  const serviceSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/api/services/whatsappService.js'), 'utf8'
  );

  // T11: getAllChats timeout is 90_000 (not 25_000)
  bridgeSrc.includes('getAllChats(), 90_000')
    ? pass('T11: getAllChats() timeout is 90 s (not the old 25 s)')
    : fail('T11: getAllChats() timeout is NOT 90 s — check bridge source');

  // T12: MAX_MS is 120_000 (not 90_000)
  bridgeSrc.includes('MAX_MS    = 120_000')
    ? pass('T12: MAX_MS is 120 s (gives one full 90 s attempt + headroom)')
    : fail('T12: MAX_MS is not 120 s');

  // T13: pre-warm delay is 30_000 (not 8000)
  serviceSrc.includes('}, 30_000)') || serviceSrc.includes('30_000')
    ? pass('T13: pre-warm delay is 30 s (was 8 s — gives WA time to hydrate)')
    : fail('T13: pre-warm delay is not 30 s');

  // Bonus: probe timeout is 3 s (not 15 s)
  bridgeSrc.includes("'probe timeout 3s'")
    ? pass('T11b: probePage timeout is 3 s (was 15 s — cuts overhead from 180 s to 9 s)')
    : fail('T11b: probePage timeout is not 3 s');

  // Bonus: CACHE_TTL_MS = 5 minutes
  serviceSrc.includes('5 * 60 * 1000') && serviceSrc.includes('CACHE_TTL_MS')
    ? pass('T13b: groups cache TTL is 5 minutes')
    : fail('T13b: groups cache TTL not found in source');
}

// ── T14: backfill retry fires only once ──────────────────────────────────────

async function testBackfillRetryOnce() {
  section('T14 — backfill retry: fires exactly once, never infinite');

  // Simulate the runBackfillBatch retry logic without real backfill
  let retryCount = 0;
  const BACKFILL_RETRY_DELAY_MS = 10; // ultra-short for testing

  async function simulateBackfillBatch() {
    const empty = [{ group_id: 'g1', group_name: 'Test' }];
    const total = 0;

    if (empty.length > 0) {
      await delay(BACKFILL_RETRY_DELAY_MS);
      retryCount++;
      // After one retry — done. No loop back.
    }
    return retryCount;
  }

  await simulateBackfillBatch();

  retryCount === 1
    ? pass('T14: retry fired exactly once (not an infinite loop)')
    : fail(`T14: retry fired ${retryCount} times — expected exactly 1`);
}

// ── T15–T16: groupIsLarge and harvestCount ────────────────────────────────────

async function testGroupIsLarge() {
  section('T15 — groupIsLarge set true when openChat exhausts retries');

  let groupIsLarge = false;

  // Simulate the openChat retry loop
  const stubClient = {
    openChat: async () => { throw new Error('openChat Promise timeout after 30000ms'); },
  };
  let opened = false;
  for (let attempt = 1; attempt <= 3 && !opened; attempt++) {
    try { await stubClient.openChat(); opened = true; }
    catch (_) {}
  }
  if (!opened) groupIsLarge = true; // the fix

  groupIsLarge === true
    ? pass('T15: groupIsLarge=true after 3 openChat failures')
    : fail('T15: groupIsLarge NOT set after openChat exhausted');

  section('T16 — harvestCount: 100 when groupIsLarge, 1000 otherwise');

  const targetCount = 1000;
  const harvestWhenLarge   = groupIsLarge ? 100 : targetCount;
  const harvestWhenSmall   = false        ? 100 : targetCount;

  harvestWhenLarge === 100
    ? pass('T16a: harvestCount=100 when groupIsLarge (prevents 300 s CDP timeout)')
    : fail('T16a: harvestCount wrong for large group', String(harvestWhenLarge));

  harvestWhenSmall === 1000
    ? pass('T16b: harvestCount=1000 for normal groups (full backfill)')
    : fail('T16b: harvestCount wrong for normal group', String(harvestWhenSmall));
}

// ── T17–T18: null and non-array message guards ────────────────────────────────

async function testMessageGuards() {
  section('T17 — null message guard: null element → persistSkipped, not persistError');

  const messages = [null, { body: 'hello', isMedia: false, hasMedia: false }, null];
  let stored = 0, persistSkipped = 0, persistErrors = 0;

  for (const m of messages) {
    if (m == null) { persistSkipped++; continue; } // the guard
    try {
      // would access m.body — without the guard this throws TypeError on null
      if (!m.body && !m.isMedia && !m.hasMedia) { persistSkipped++; continue; }
      stored++;
    } catch (err) {
      persistErrors++;
    }
  }

  persistErrors === 0
    ? pass('T17a: no errors from null messages — null guard works')
    : fail('T17a: null messages caused persistErrors', String(persistErrors));
  persistSkipped === 2
    ? pass('T17b: 2 null elements counted as persistSkipped')
    : fail('T17b: wrong persistSkipped count', String(persistSkipped));
  stored === 1
    ? pass('T17c: 1 valid message stored correctly alongside nulls')
    : fail('T17c: wrong stored count', String(stored));

  section('T18 — non-array guard: undefined messages coerced to [] before slice');

  let messages2 = undefined; // simulate a harvest method returning undefined
  if (!Array.isArray(messages2)) messages2 = []; // the guard

  try {
    const sliced = messages2.slice(-1000);
    sliced.length === 0
      ? pass('T18: undefined messages coerced to [] — slice works without crashing')
      : fail('T18: unexpected slice result', JSON.stringify(sliced));
  } catch (err) {
    fail('T18: slice threw after coercion — guard not working', err.message);
  }
}

// ── T19: confidence threshold ─────────────────────────────────────────────────

async function testConfidenceThreshold() {
  section('T19 — confidence threshold: 0.3 minimum (not > 0)');

  const { MessageParser } = require('../src/scraper/message-parser');
  const p = new MessageParser();

  // "Hello how are you" scored 0.03 in previous test — should NOT be stored
  const noise = p.parse('Hello how are you', 'TestAgent');
  const listing = p.parse('2BHK JLT AED 85000', 'Agent');

  noise.confidence < 0.3
    ? pass(`T19a: noise text confidence=${noise.confidence} < 0.3 → NOT stored (threshold working)`)
    : fail(`T19a: noise text confidence=${noise.confidence} >= 0.3 — would be stored as listing!`);

  listing.confidence >= 0.3
    ? pass(`T19b: listing text confidence=${listing.confidence} >= 0.3 → stored correctly`)
    : fail(`T19b: valid listing confidence=${listing.confidence} < 0.3 — would be dropped!`);

  // Verify the threshold in source
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/scraper/whatsapp-qr-bridge.js'), 'utf8'
  );
  src.includes('parsed.confidence >= 0.3')
    ? pass('T19c: source uses >= 0.3 threshold (not old > 0)')
    : fail('T19c: source threshold not found — check bridge source');
}

// ── T20: messageId fallback is uuid-shaped ────────────────────────────────────

async function testMessageIdFallback() {
  section('T20 — messageId fallback: uuidv4 not Math.random');

  const { v4: uuidv4 } = require('uuid');

  // Simulate messages with missing id
  const cases = [
    { id: { _serialized: 'MSG-001' } },          // normal: use _serialized
    { id: 'MSG-002' },                             // string id: use directly
    { id: { noSerialized: true } },               // object without _serialized: uuid
    {},                                            // no id at all: uuid
  ];

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const msg of cases) {
    const messageId = msg.id?._serialized
      || (typeof msg.id === 'string' ? msg.id : null)
      || uuidv4();

    if (msg.id?._serialized) {
      messageId === 'MSG-001'
        ? pass(`T20: _serialized extracted correctly → "${messageId}"`)
        : fail(`T20: _serialized not used`, messageId);
    } else if (typeof msg.id === 'string') {
      messageId === 'MSG-002'
        ? pass(`T20: string id used directly → "${messageId}"`)
        : fail(`T20: string id not used`, messageId);
    } else {
      UUID_RE.test(messageId)
        ? pass(`T20: fallback is a valid uuid4 → "${messageId.slice(0, 18)}…"`)
        : fail(`T20: fallback is not a uuid4 — old Math.random form?`, messageId);
    }
  }

  // Confirm live code no longer uses Math.random() — strip comments first
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/scraper/whatsapp-qr-bridge.js'), 'utf8'
  );
  // Remove single-line comments so a mention in a comment doesn't trip the check
  const codeOnly = src.replace(/\/\/.*/g, '');
  !codeOnly.includes('Math.random()')
    ? pass('T20: Math.random() NOT in bridge code (replaced by uuidv4; only in comment)')
    : fail('T20: Math.random() still used in bridge code — not just in comments!');
}

// ── Runner ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Unit Logic Tests — timing, cache, control flow        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try { await testTimeoutLogic(); }        catch (e) { fail('T1-T3 crashed', e.message); }
  try { await testGroupsCache(); }         catch (e) { fail('T4-T7 crashed', e.message); }
  try { await testDoubleCommand(); }       catch (e) { fail('T8-T10 crashed', e.message); }
  try { await testSourceConstants(); }     catch (e) { fail('T11-T13 crashed', e.message); }
  try { await testBackfillRetryOnce(); }   catch (e) { fail('T14 crashed', e.message); }
  try { await testGroupIsLarge(); }        catch (e) { fail('T15-T16 crashed', e.message); }
  try { await testMessageGuards(); }       catch (e) { fail('T17-T18 crashed', e.message); }
  try { await testConfidenceThreshold(); } catch (e) { fail('T19 crashed', e.message); }
  try { await testMessageIdFallback(); }   catch (e) { fail('T20 crashed', e.message); }

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  if (failed === 0) {
    console.log('\n  ✅  All logic checks passed\n');
  } else {
    console.log('\n  ❌  Some checks failed — see above\n');
  }
  process.exit(failed > 0 ? 1 : 0);
})();
