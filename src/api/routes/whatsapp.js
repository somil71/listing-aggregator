const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, authenticateSSE, createSSENonce } = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');
const { whatsappBreaker } = require('../middleware/circuitBreaker');
const auditLog = require('../middleware/auditLog');

const router = express.Router();

// Per-user rate limit for the destructive /reparse route — 2 calls per hour
const reparseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || req.socket.remoteAddress || 'anon',
  message: {
    success: false,
    error: 'Reparse limit reached. You can only re-parse listings twice per hour.',
  },
});

// ── SSE nonce exchange ─────────────────────────────────────────────────────
// Client calls this (with Bearer auth) to get a 30-second single-use token
// for the EventSource connection.  The JWT never travels in a URL.
router.post('/sse-token', authenticate, async (req, res) => {
  try {
    const nonce = await createSSENonce(req.userId);
    res.json({ success: true, data: { token: nonce } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to mint stream token' });
  }
});

// ── SSE stream ─────────────────────────────────────────────────────────────
// EventSource can't set custom headers — we use a one-time nonce (above) so
// the Clerk JWT never appears in URLs, browser history, or server logs.
router.get('/qr-stream', authenticateSSE, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Immediate ping so the client knows the channel is open
  res.write('event: connected\ndata: {}\n\n');

  whatsappService.registerSSE(req.userId, res);
  req.on('close', () => whatsappService.removeSSE(req.userId));
});

// ── QR initiation (circuit-breaker protected) ──────────────────────────────
router.post('/initiate-qr', authenticate, auditLog('initiate_qr', 'whatsapp'), async (req, res) => {
  try {
    const result = await whatsappBreaker.execute(
      // forceClean wipes the Chromium profile before spawning so stale session
      // keys from a previous failed/expired QR don't cause "could not link device".
      () => whatsappService.initiateQR(req.userId, { forceClean: true })
    );
    // Lease conflict — another instance owns this user's session.
    // 409 is the right semantic: the resource exists but belongs elsewhere.
    if (result?.status === 'owned_by_other') {
      return res.status(409).json({ success: false, error: result.message, data: result });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.code === 'CIRCUIT_OPEN') {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp service temporarily unavailable. Please try again in a few minutes.',
      });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Helper — translate a circuit-open rejection into a clean 503 instead of
// leaking the breaker error to clients.
function _withWhatsappBreaker(fn) {
  return async (req, res) => {
    try {
      const data = await whatsappBreaker.execute(() => fn(req));
      res.json({ success: true, data });
    } catch (err) {
      if (err.code === 'CIRCUIT_OPEN') {
        return res.status(503).json({
          success: false,
          error: 'WhatsApp service temporarily unavailable. Please try again in a minute.',
        });
      }
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

// ── Connection status ──────────────────────────────────────────────────────
router.get('/status', authenticate, _withWhatsappBreaker(
  async (req) => whatsappService.getStatus(req.userId)
));

// ── List all groups from connected phone ───────────────────────────────────
// NOT wrapped in the circuit breaker: a slow/failed group scan is a per-request
// concern, but the breaker is SHARED with /status and /initiate-qr. When /groups
// failures tripped it, those routes started returning 503 too — so a single bad
// scan locked the user out of reconnecting. Handle errors locally instead.
router.get('/groups', authenticate, async (req, res) => {
  if (!whatsappService.isConnected(req.userId)) {
    return res.status(409).json({
      success: false,
      error: 'WhatsApp is not connected. Please scan the QR code first.',
    });
  }
  try {
    const groups = await whatsappService.getGroups(req.userId);
    res.json({ success: true, data: { groups } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not load groups. Please try again.' });
  }
});

// ── Save selected groups ───────────────────────────────────────────────────
router.post('/select-groups', authenticate, async (req, res) => {
  try {
    const { groupIds, groupNames } = req.body;
    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Select at least one group' });
    }
    if (groupIds.length > 100) {
      return res.status(400).json({ success: false, error: 'Cannot monitor more than 100 groups at once' });
    }
    const result = await whatsappService.selectGroups(req.userId, groupIds, groupNames);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Disconnect ─────────────────────────────────────────────────────────────
router.post('/disconnect', authenticate, _withWhatsappBreaker(
  async (req) => { await whatsappService.disconnect(req.userId); return { message: 'Disconnected' }; }
));

// ── Rescrape (re-backfill historical messages) ─────────────────────────────
router.post('/rescrape', authenticate, _withWhatsappBreaker(
  async (req) => whatsappService.rescrape(req.userId)
));

// ── Re-parse (re-run Groq on all stored raw_messages for this user) ─────────
// Deletes existing listings for the user, then re-queues all raw_messages.
// Destructive: requires an explicit confirmation header AND a per-user rate
// limit (max 2 calls/hour) so a buggy client cannot wipe a user's data.
router.post('/reparse', authenticate, reparseLimiter, auditLog('reparse_listings', 'listing'), async (req, res) => {
  // Defence-in-depth: require an explicit confirmation header set by the UI
  // so a CSRF-style misdirected POST or accidental fetch cannot wipe data.
  if (req.headers['x-confirm-reparse'] !== 'true') {
    return res.status(400).json({
      success: false,
      error: 'Missing X-Confirm-Reparse: true header. This action permanently deletes parsed listings — confirm in the UI.',
    });
  }

  const pg    = require('../../db/postgres/pool');
  const queue = require('../../queue/upstashClient');
  const { PARSE_QUEUE } = require('../../db/dualWrite');
  try {
    const clerkUserId = req.userId;
    const userRow = await pg.dbGet(
      'SELECT id FROM users WHERE clerk_user_id = $1', [clerkUserId]
    );
    if (!userRow) return res.json({ success: true, data: { requeued: 0 } });

    const pgUserId = userRow.id;

    // 1. Delete all existing listings for this user
    const delRes = await pg.query(
      'DELETE FROM listings WHERE user_id = $1', [pgUserId]
    );
    const deletedListings = delRes.rowCount ?? 0;

    // 2. Fetch all raw_messages for this user
    const msgs = await pg.query(
      `SELECT r.id, r.text, r.sender_name, r.wa_group_id, r.ts_received,
              mg.group_name
         FROM raw_messages r
         LEFT JOIN monitored_groups mg
           ON mg.user_id = r.user_id AND mg.wa_group_id = r.wa_group_id
        WHERE r.user_id = $1
        ORDER BY r.ts_received DESC`,
      [pgUserId]
    );

    // 3. Re-queue each one
    let requeued = 0;
    for (const row of msgs.rows) {
      try {
        await queue.enqueue(PARSE_QUEUE, {
          raw_id:      row.id,
          text:        row.text,
          sender_name: row.sender_name,
          wa_group_id: row.wa_group_id,
          group_name:  row.group_name,
          ts_received: row.ts_received,
        });
        requeued++;
      } catch (_) {}
    }

    res.json({ success: true, data: { deletedListings, requeued } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
