// Standalone subprocess that runs wppconnect in isolation.
// The Express server spawns this once per userId.  Events go to
// data/wwebjs-state/<userId>.jsonl which the server tails.
//
// We switched from whatsapp-web.js → @wppconnect-team/wppconnect because:
//   - wppconnect is actively maintained against current WhatsApp Web
//   - whatsapp-web.js 1.34.7 broke on the current Store layout
//     ("Cannot read properties of null (reading 'Socket')")

const fs = require('fs');
const path = require('path');
const wppconnect = require('@wppconnect-team/wppconnect');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbAll } = require('../api/db-helpers');
const { MessageParser } = require('./message-parser');

// Try to use the Redis-backed event bus. Falls back to filesystem when
// Redis is unavailable (single-instance dev mode).
let bridgeBus = null;
try { bridgeBus = require('../api/services/bridgeBus'); } catch (_) {}

// Lazy Postgres handle. The monitored-groups list MUST come from Postgres
// (Neon, external → survives redeploys); the SQLite copy lives on the
// container's ephemeral disk and is wiped on every deploy. pool.js throws if
// DATABASE_URL is unset, so guard the require and fall back to SQLite.
let _pg = null;
let _pgTried = false;
function getPg() {
  if (_pgTried) return _pg;
  _pgTried = true;
  try { _pg = require('../db/postgres/pool'); }
  catch (err) { process.stderr.write(`[bridge] Postgres unavailable, using SQLite: ${err.message}\n`); _pg = null; }
  return _pg;
}

const MEDIA_DIR = path.resolve(__dirname, '../../data/media');
const parser = new MessageParser();

const [, , userId, authDir, chromeExec] = process.argv;

if (!userId || !authDir) {
  console.error('Usage: node whatsapp-qr-bridge.js <userId> <authDir> [chromeExec]');
  process.exit(2);
}

const STATE_DIR = path.resolve(__dirname, '../../data/wwebjs-state');
fs.mkdirSync(STATE_DIR, { recursive: true });
const stateFile = path.join(STATE_DIR, `${userId}.jsonl`);
const cmdFile = path.join(STATE_DIR, `${userId}.cmd`);

try { fs.writeFileSync(stateFile, ''); } catch (_) {}

function emit(type, data = {}) {
  const evt = { type, data, ts: Date.now() };
  // Publish to Redis pub/sub (any instance can subscribe to bridge events).
  if (bridgeBus) {
    bridgeBus.publishEvent(userId, evt).catch(() => {});
  }
  // Always also write the filesystem JSONL for single-instance dev mode and
  // for the durable replay buffer (server tails it when no Redis).
  const line = JSON.stringify(evt) + '\n';
  try { fs.appendFileSync(stateFile, line); } catch (e) {
    process.stderr.write(`[bridge] failed to write state: ${e.message}\n`);
  }
  process.stderr.write(`[bridge] ${type}\n`);
}

// Boot timestamp — any command whose ts predates this was queued for a
// previous incarnation of the bridge (e.g. a stale 'disconnect' from the
// dashboard's reconnect flow) and must be ignored, or it would kill us.
// A small skew allowance covers clock jitter between server and bridge.
const BOOT_TS = Date.now();
const CMD_STALE_SKEW_MS = 2000;

emit('boot', { authDir, chromeExec: chromeExec || '(default)' });

let activeClient = null;
let qrReadEmitted = false;  // dedupe statusFind = 'qrReadSuccess' callbacks
let monitoredGroupIds = new Set();  // group IDs currently being scraped
let messageListenerWired = false;   // wppconnect onMessage subscription guard

// ── Page mutex ────────────────────────────────────────────────────────────
// All exclusive CDP sequences (backfill, get_groups scan) share ONE Chromium
// page. Running two of them concurrently destroys the JS execution context
// mid-call → "Protocol error (Runtime.callFunctionOn): Promise was collected".
// withPageLock serialises them so only one heavy CDP sequence touches the page
// at a time. It is FIFO and never rejects the chain (errors are swallowed for
// the *chain*, but propagated to the caller of the locked fn).
let _pageMutex = Promise.resolve();
function withPageLock(fn) {
  const run = _pageMutex.then(() => fn());
  _pageMutex = run.then(() => {}, () => {});
  return run;
}

// Guard so overlapping POST /rescrape (or repeated start_monitoring) don't
// stack multiple full backfills over the same set of groups.
let _backfillInFlight = false;

// ── Message persistence (mirrors scraper/whatsapp-scraper.js but for wppconnect) ──
async function downloadMedia(message, messageId) {
  if (!message.isMedia && !message.isMMS && !message.mimetype) return [];
  try {
    const buf = await activeClient.decryptFile(message);
    if (!buf) return [];
    const ext = (message.mimetype?.split('/')[1]?.split(';')[0]) || 'bin';
    const filename = `${messageId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const filepath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filepath, buf);
    return [filepath];
  } catch (err) {
    process.stderr.write(`[bridge] media download failed: ${err.message}\n`);
    return [];
  }
}

// Dual-write helper.  Lazy-required so missing pg env vars don't crash the
// bridge when running without Postgres configured.
let _dualWrite = null;
function getDualWrite() {
  if (_dualWrite === null) {
    try {
      _dualWrite = require('../db/dualWrite');
    } catch (err) {
      process.stderr.write(`[bridge] dual-write disabled: ${err.message}\n`);
      _dualWrite = false;
    }
  }
  return _dualWrite || null;
}

async function persistMessage(message, groupName) {
  // isMedia = whatsapp-web.js field; hasMedia = wppconnect field.  Accept either
  // so backfill messages (wppconnect) and live messages (onMessage) both pass.
  if (!message.body && !message.isMedia && !message.hasMedia) return;

  const messageId = message.id?._serialized || message.id || `${Date.now()}-${Math.random()}`;
  const ts = message.t ? new Date(message.t * 1000).toISOString() : new Date().toISOString();

  // sender_wa_id = the WhatsApp contact ID (e.g. "919XXXXXXXXX@c.us" or "@lid" internal ID)
  const senderWaId = message.author || message.from || message.sender?.id?._serialized || null;

  // sender_name = the human-readable push name shown in WhatsApp (their profile display name).
  // Prefer notifyName/senderName (actual display name) over the raw contact ID.
  // If only @lid is available we still get their chosen name — much more useful than an ID.
  const senderName = message.notifyName
    || message.senderName
    || message.sender?.pushname
    || message.sender?.name
    || message.sender?.formattedName
    || (senderWaId && !senderWaId.includes('@lid') && !senderWaId.includes('@s.whatsapp.net') ? senderWaId : null)
    || 'unknown';

  // For media messages, body is the raw base64 blob — use caption instead.
  const text = (message.isMedia || message.hasMedia || message.type === 'image' || message.type === 'video')
    ? (message.caption || '')
    : (message.body || message.caption || '');

  const imagePaths = await downloadMedia(message, messageId);

  // Path A: existing SQLite write (kept as source of truth during cutover)
  await dbRun(
    `INSERT OR IGNORE INTO raw_messages
       (id, group_name, sender_name, message_text, timestamp, has_images, image_count, image_paths)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [messageId, groupName, senderName, text, ts,
     imagePaths.length > 0 ? 1 : 0, imagePaths.length, JSON.stringify(imagePaths)]
  );

  const parsed = parser.parse(text, senderName);
  // Threshold: 0.3 minimum.  The parser returns tiny non-zero scores (e.g. 0.03)
  // for greetings / non-listing text that happen to match a loose pattern.  We
  // only want confident extractions in the listings table.  0.3 is well below the
  // "real listing" zone (typically 0.7+) but safely above the noise floor.
  if (parsed.confidence >= 0.3) {
    await dbRun(
      `INSERT OR IGNORE INTO listings
         (id, raw_message_id, price, location, bedrooms, property_type, area_sqft,
          furnished, parking, agent_phone, agent_name, description, group_name,
          extraction_confidence, image_paths, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, messageId, parsed.price, parsed.location, parsed.bedrooms,
       parsed.property_type, parsed.area_sqft, parsed.furnished, parsed.parking,
       parsed.agent_phone, parsed.agent_name, parsed.description, groupName,
       parsed.confidence, JSON.stringify(imagePaths), parsed.currency || null]
    );
    emit('listing_stored', {
      groupName,
      confidence: parsed.confidence,
      location: parsed.location || null,
      price: parsed.price || null,
    });
  }

  // Path B: Postgres dual-write + parse queue (best-effort, never blocks)
  const dw = getDualWrite();
  if (dw) {
    try {
      // wa_group_id resolution: try every field wppconnect might use for the chat ID.
      // chatId._serialized is preferred (the full WA ID e.g. 12345@g.us).
      // message.from is the group ID for group messages (author = sender inside group).
      // chatId.remote._serialized appears in some older wppconnect builds.
      // Falling back to '' silently stores an empty group ID in Postgres, which
      // breaks the monitored_groups counter — so we prefer any non-empty candidate.
      const chatId = message.chatId?._serialized
        || message.from
        || message.chatId?.remote?._serialized
        || message.to
        || '';
      await dw.writeRawMessage({
        user_id: userId,
        wa_group_id: chatId,
        wa_message_id: messageId,
        sender_wa_id: senderWaId,  // raw WA contact ID (may be @lid)
        sender_name: senderName,   // human display name (pushname) — always preferred
        text,
        ts_received: ts,
        has_media: imagePaths.length > 0,
        media_keys: imagePaths,
        group_name: groupName,
      });
    } catch (err) {
      process.stderr.write(`[bridge] dual-write error: ${err.message}\n`);
    }
  }
}

async function loadMonitoredGroups() {
  // Prefer Postgres (persistent across redeploys). A successful PG read is
  // authoritative even when it returns zero rows. Only fall back to SQLite if
  // the PG read itself fails or PG isn't configured.
  let rows = null;
  const pg = getPg();
  if (pg) {
    try {
      rows = await pg.dbAll(
        `SELECT mg.wa_group_id AS group_id, mg.group_name
           FROM monitored_groups mg
           JOIN users u ON u.id = mg.user_id
          WHERE u.clerk_user_id = $1 AND mg.is_active = true`,
        [userId]
      );
    } catch (err) {
      process.stderr.write(`[bridge] loadMonitoredGroups: PG read failed (${err.message}); falling back to SQLite\n`);
      rows = null;
    }
  }
  if (rows === null) {
    try {
      rows = await dbAll('SELECT group_id, group_name FROM selected_groups WHERE user_id = ?', [userId]);
    } catch (err) {
      // Non-fatal: emit a warning, not 'error'. Emitting 'error' causes the
      // server to tear the bridge down (it treats it as a fatal crash), which
      // would orphan the Chromium process and leave the user stuck.
      emit('backfill_warning', { reason: 'load_groups_failed', message: err.message });
      return [];
    }
  }
  monitoredGroupIds = new Set(rows.map(r => r.group_id));
  emit('monitoring', { count: monitoredGroupIds.size });
  return rows;
}

function wireMessageListener() {
  if (messageListenerWired || !activeClient) return;
  messageListenerWired = true;
  activeClient.onMessage(async (message) => {
    try {
      // Filter: only group messages, only monitored groups
      const chatId = message.chatId?._serialized || message.from || '';
      if (!message.isGroupMsg && !chatId.endsWith('@g.us')) return;
      if (!monitoredGroupIds.has(chatId)) return;

      // Resolve group name (cache via chat info)
      let groupName = message.chat?.name || message.chatName;
      if (!groupName) {
        try {
          const chat = await activeClient.getChatById(chatId);
          groupName = chat?.name || chat?.formattedTitle || chatId;
        } catch (_) { groupName = chatId; }
      }

      await persistMessage(message, groupName);
    } catch (err) {
      process.stderr.write(`[bridge] onMessage handler error: ${err.message}\n`);
    }
  });
  emit('listener_wired', {});
}

async function backfillGroup(groupId, groupName, targetCount = 1000) {
  emit('backfill_start', { groupName, targetCount });

  // Guard: activeClient can go null if the user disconnects mid-backfill.
  // Without this check, `activeClient[name]` below throws TypeError which
  // propagates to runBackfillBatch's catch and emits a warning (harmless),
  // but also makes the entire page-lock hang rather than releasing cleanly.
  if (!activeClient) {
    emit('backfill_warning', { groupName, reason: 'client_gone', message: 'activeClient is null — skipping' });
    return 0;
  }

  const list = (name) => typeof activeClient[name] === 'function';
  emit('backfill_methods', {
    groupName,
    has: {
      getMessages: list('getMessages'),
      loadEarlierMessages: list('loadEarlierMessages'),
      getAllMessagesInChat: list('getAllMessagesInChat'),
      loadAndGetAllMessagesInChat: list('loadAndGetAllMessagesInChat'),
      openChat: list('openChat'),
      sendSeen: list('sendSeen'),
    },
  });

  // ── ISOLATION INSTRUMENTATION ────────────────────────────────────────────
  // We don't yet know WHERE backfill stalls. Wrap every CDP call so each one
  // logs: when it started, how long it ran, and the full error if it threw.
  // This lets us see in the logs exactly which call hangs and for how long,
  // rather than guessing that "openChat times out".
  const timed = async (label, fn, extra = {}) => {
    const t0 = Date.now();
    emit('cdp_start', { groupName, label, ...extra });
    process.stderr.write(`[bridge] CDP→ ${label} (${groupName})\n`);
    try {
      const result = await fn();
      const ms = Date.now() - t0;
      emit('cdp_ok', { groupName, label, ms, ...extra });
      process.stderr.write(`[bridge] CDP✓ ${label} ${ms}ms\n`);
      return result;
    } catch (e) {
      const ms = Date.now() - t0;
      emit('cdp_fail', {
        groupName, label, ms,
        error: e.message,
        stack: (e.stack || '').split('\n').slice(0, 4).join(' | '),
        ...extra,
      });
      process.stderr.write(`[bridge] CDP✗ ${label} ${ms}ms — ${e.message}\n`);
      throw e;
    }
  };

  // Pre-flight: is the page/CDP channel even responsive RIGHT NOW? Probe with
  // the cheapest call available. If this returns fast but openChat hangs, the
  // problem is openChat specifically. If this ALSO hangs, the whole Chromium
  // page is frozen (different bug — likely OOM / crashed renderer).
  const probePage = async () => {
    const probes = ['getConnectionState', 'isConnected', 'getWAVersion', 'getHostDevice'];
    for (const p of probes) {
      if (!list(p)) continue;
      const t0 = Date.now();
      try {
        const r = await Promise.race([
          activeClient[p](),
          new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout 15s')), 15_000)),
        ]);
        emit('backfill_probe', {
          groupName, probe: p, ms: Date.now() - t0,
          alive: true, result: String(r && r.id ? r.id : r).slice(0, 40),
        });
        return true;
      } catch (e) {
        emit('backfill_probe', {
          groupName, probe: p, ms: Date.now() - t0, alive: false, error: e.message,
        });
        // try the next probe method before declaring the page dead
      }
    }
    return false;
  };

  let messages = [];

  // Step 0: WhatsApp Web only fetches a chat's message history when the chat
  // is "opened" (clicked) in the UI.  Without this, loadEarlierMessages is a
  // no-op.  We open the chat and wait briefly for the initial load.
  //
  // openChat is best-effort: on some Railway environments the CDP promise
  // hangs indefinitely (page is alive but the JS event that resolves openChat
  // never fires). We fail fast (3 × 30s = 90s max) and fall through to a
  // direct harvest — getAllMessagesInChat (Step 2) reads from the in-memory WA
  // store which is already populated by the multi-device history sync, so
  // recent messages (last 24-72 h) are captured even without openChat.
  let openChatSucceeded = false;
  // Set to true when the Step-0b peek times out — indicates the WA store already
  // holds so many messages that getAllMessagesInChat will also timeout (it serialises
  // everything). Used below to skip the two heavy harvest fallbacks and go straight
  // to getMessages({ count: targetCount }) which is bounded and always fast.
  let groupIsLarge = false;
  if (list('openChat')) {
    // openChat occasionally rejects with a transient Puppeteer error or CDP
    // timeout. Retry a small number of times with a short per-attempt timeout
    // so we fail fast when the environment doesn't support it.
    let opened = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3 && !opened; attempt++) {
      // ISOLATION: before each openChat, probe whether the page is alive at all.
      // This separates "openChat is slow" from "the whole renderer is frozen".
      const pageAlive = await probePage();
      emit('backfill_openchat_attempt', {
        groupId, groupName, attempt, pageAlive,
      });

      try {
        // Short per-attempt timeout: if openChat hasn't resolved in 30s it is
        // hanging indefinitely — fail fast so we can fall through to the direct
        // store harvest below.
        const timeoutMs = 30_000;
        // timed() logs start + duration + full error, so the logs show exactly
        // how long openChat ran before it hung or rejected.
        await timed('openChat', () => {
          const openPromise = activeClient.openChat(groupId);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`openChat Promise timeout after ${timeoutMs}ms`)),
              timeoutMs
            )
          );
          return Promise.race([openPromise, timeoutPromise]);
        }, { attempt, timeoutMs });

        await new Promise(r => setTimeout(r, 2500));
        // openChat succeeded — record that FIRST. sendSeen is a non-essential
        // "mark as read" nicety; isolation logs proved it can hang forever
        // (no settle), and because it used to run BEFORE this emit it dead-
        // stalled the entire backfill right after the chat opened. So: mark
        // opened immediately, then attempt sendSeen behind a hard 5s timeout
        // and never let it block.
        opened = true;
        openChatSucceeded = true;
        emit('backfill_chat_opened', { groupId, groupName, attempt });
        if (list('sendSeen')) {
          try {
            await timed('sendSeen', () => Promise.race([
              activeClient.sendSeen(groupId),
              new Promise((_, rej) => setTimeout(() => rej(new Error('sendSeen timeout 5s')), 5000)),
            ]), { attempt });
          } catch (_) { /* non-fatal — chat is already open */ }
        }
      } catch (e) {
        lastErr = e;
        emit('backfill_warning', {
          groupId, groupName, reason: 'open_retry',
          attempt, message: `${e.message}`,
        });
        // Short backoff between fast retries.
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!opened) {
      // openChat exhausted its retries — this is non-fatal.
      // loadEarlierMessages (Step 1) needs an open chat to trigger server fetches
      // so it is skipped. But getAllMessagesInChat (Step 2) reads from the
      // in-memory WA store which is populated by multi-device history sync,
      // so recent messages are still harvested below.
      //
      // A group that refuses to open is definitionally heavy: its JS store is
      // either empty (openChat never loaded it) or so large that openChat itself
      // times out.  In either case the Step 0b getAllMessagesInChat peek will
      // return instantly (empty store → no data to serialise → no 10 s timeout),
      // so the 0b_peek_timeout branch that normally sets groupIsLarge will never
      // fire.  We must set it here so getMessages(harvest) uses count:100 instead
      // of count:1000 and stays well inside the 300 s CDP protocolTimeout.
      groupIsLarge = true;
      emit('backfill_warning', {
        groupId, groupName, reason: 'open_failed_continuing',
        message: lastErr ? lastErr.message : 'unknown',
        note: 'Falling through to direct store harvest — Steps 0b and 2 still run; groupIsLarge forced true',
      });
      // DO NOT return 0 — fall through to Steps 0b and 2 below.
    }
  }

  // Step 0b: wait for WhatsApp Web to finish streaming the chat's RECENT
  // history before we harvest.  This is the fix for "messages sent while the
  // bridge was offline never show up after reconnect": on a freshly (re)linked
  // device the phone pushes the backlog over several seconds, so harvesting the
  // instant the chat opens grabs a shallow, stale snapshot (we observed exactly
  // 15 old messages — none of the gap). Poll the loaded-message count and wait
  // until it stops growing for a few rounds, capped at a ~30s budget. Unlike
  // Step 1 (which scrolls UP for OLD history), this lets the NEWEST messages
  // land first.
  if (list('getAllMessagesInChat')) {
    emit('backfill_step', { groupName, step: '0b_sync_start' });
    let prev = -1, stable = 0;
    let syncTimedOut = false; // set when a peek hits the 10s cap — used in backfill_synced below
    // 10s cap per peek: for large groups getAllMessagesInChat serialises thousands of
    // message objects over CDP and can block for the full 5-minute protocolTimeout.
    // A slow peek means the WA store is already populated; break immediately and let
    // Step 2 harvest whatever is there — no need to wait for stability.
    const PEEK_TIMEOUT_MS = 10_000;
    for (let i = 0; i < 30 && stable < 4; i++) {
      const t0 = Date.now();
      let peek;
      try {
        peek = await Promise.race([
          activeClient.getAllMessagesInChat(groupId, true, false),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('peek_timeout')), PEEK_TIMEOUT_MS)),
        ]);
      } catch (e) {
        const ms = Date.now() - t0;
        if (e.message === 'peek_timeout') {
          // Large group: slow getAllMessagesInChat == store is already populated AND
          // the harvest's getAllMessages* calls will also timeout. Flag it so Step 2
          // skips the two unbounded methods and goes straight to getMessages.
          groupIsLarge = true;
          syncTimedOut = true;
          emit('backfill_step', { groupName, step: '0b_peek_timeout', iter: i, ms });
          break;
        }
        emit('cdp_fail', { groupName, label: 'getAllMessagesInChat(sync)', iter: i, ms, error: e.message });
        peek = [];
      }
      const ms = Date.now() - t0;
      // Only log slow peeks (>3s) or the first iteration — avoid flooding logs.
      if (i === 0 || ms > 3000) {
        emit('cdp_ok', { groupName, label: 'getAllMessagesInChat(sync)', iter: i, ms, count: peek.length });
      }
      if (peek.length === prev) stable++; else { stable = 0; prev = peek.length; }
      await new Promise(r => setTimeout(r, 1000));
    }
    // prev = -1 means the loop exited on a peek_timeout before any successful peek
    // (store is large, not empty). Emit 0 + timedOut:true so callers can
    // distinguish "genuinely empty store" from "store too large to count quickly".
    emit('backfill_synced', {
      groupId, groupName,
      loaded: prev < 0 ? 0 : prev,
      timedOut: syncTimedOut,
    });
  }

  // Step 1: scroll back through the chat repeatedly to force WA Web to
  // download historical messages from the server.  Now that the chat is
  // open, loadEarlierMessages actually triggers backend fetches.
  // Skipped when openChat didn't succeed — the scroll is a no-op without it.
  if (openChatSucceeded) try {
    if (list('loadEarlierMessages')) {
      emit('backfill_step', { groupName, step: '1_scroll_start' });
      let stable = 0;
      let lastCount = -1;
      // After a peek timeout we skip all subsequent peeks; stability falls back to
      // loadEarlierMessages returning [] (which means "no more history to load").
      let skipScrollPeek = false;
      for (let i = 0; i < 50 && stable < 4; i++) {
        const t0 = Date.now();
        try {
          const result = await activeClient.loadEarlierMessages(groupId);
          const ms = Date.now() - t0;
          if (i === 0 || ms > 3000) {
            emit('cdp_ok', { groupName, label: 'loadEarlierMessages', iter: i, ms });
          }
          // result is usually an array — empty means "no more to load"
          if (Array.isArray(result) && result.length === 0) stable++;
          else stable = 0;
          // small wait so WA Web can fetch + render
          await new Promise(r => setTimeout(r, 600));
        } catch (e) {
          emit('cdp_fail', { groupName, label: 'loadEarlierMessages', iter: i, ms: Date.now() - t0, error: e.message });
          // some chats reject when at top; treat as "no more"
          stable++;
        }
        // peek at total count so far — capped at 10s to avoid hanging on large groups.
        // After a single timeout, skip all remaining peeks; stability is tracked via
        // loadEarlierMessages returning [] above.
        if (!skipScrollPeek && list('getAllMessagesInChat')) {
          const tp = Date.now();
          try {
            const peek = await Promise.race([
              activeClient.getAllMessagesInChat(groupId, true, false),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error('peek_timeout')), 10_000)),
            ]);
            if (peek.length === lastCount) stable++; else stable = 0;
            lastCount = peek.length;
            if (peek.length >= targetCount) break;
          } catch (e) {
            if (e.message === 'peek_timeout') {
              skipScrollPeek = true;
              emit('backfill_step', { groupName, step: '1_peek_disabled', iter: i, ms: Date.now() - tp });
            } else {
              emit('cdp_fail', { groupName, label: 'getAllMessagesInChat(scroll)', iter: i, ms: Date.now() - tp, error: e.message });
            }
          }
        }
      }
      emit('backfill_scrolled', { groupName, attempts: 50, finalCount: lastCount });
    }
  } catch (e) {
    // scroll-load failure is also non-fatal — we still try to harvest
    // whatever's already loaded below.
    emit('backfill_warning', { groupName, reason: 'scroll_failed', message: e.message });
  }

  // Step 2: harvest everything that's now loaded.
  // getAllMessagesInChat / loadAndGetAllMessagesInChat serialise the ENTIRE WA store
  // for the group — fast for small groups, but for large groups they hit the 5-min
  // protocolTimeout.  Skip them when groupIsLarge and fall straight through to
  // getMessages({ count: targetCount }) which is bounded and always completes quickly.
  emit('backfill_step', { groupName, step: '2_harvest_start', groupIsLarge });
  if (!groupIsLarge && list('getAllMessagesInChat')) {
    try {
      messages = await timed('getAllMessagesInChat(harvest)', () => activeClient.getAllMessagesInChat(groupId, true, false));
      emit('backfill_loaded', { groupName, method: 'getAllMessagesInChat', count: messages.length });
    } catch (e) {
      emit('backfill_warning', { groupName, reason: 'harvest_failed', message: e.message });
    }
  }

  if (!groupIsLarge && messages.length === 0 && list('loadAndGetAllMessagesInChat')) {
    try {
      messages = await timed('loadAndGetAllMessagesInChat(harvest)', () => activeClient.loadAndGetAllMessagesInChat(groupId, true, false));
      emit('backfill_loaded', { groupName, method: 'loadAndGetAllMessagesInChat', count: messages.length });
    } catch (e) {
      emit('backfill_warning', { groupName, reason: 'harvest_failed', message: e.message });
    }
  }

  if (messages.length === 0 && list('getMessages')) {
    try {
      // Large groups have thousands of messages loaded in the WA Web JS store.
      // getMessages still serialises each result object over CDP, so count:1000
      // routinely hits the 300 s protocolTimeout.  Use a much smaller count for
      // large groups to stay within the budget — 100 recent messages is plenty
      // to seed the dashboard while keeping CDP round-trip time well under 30 s.
      const harvestCount = groupIsLarge ? 100 : targetCount;
      messages = await timed('getMessages(harvest)', () =>
        activeClient.getMessages(groupId, { count: harvestCount, direction: 'before' }));
      emit('backfill_loaded', { groupName, method: 'getMessages', count: messages.length, harvestCount });
    } catch (e) {
      emit('backfill_warning', { groupName, reason: 'harvest_failed', method: 'getMessages', message: e.message });
    }
  }

  emit('backfill_step', { groupName, step: '3_persist_start', toPersist: Math.min(messages.length, targetCount) });

  // Message-format probe: log the first message's top-level keys and a few
  // critical fields.  This fires once per backfill and tells us immediately:
  //   (a) whether wppconnect returned the expected shape, and
  //   (b) whether body/isMedia/hasMedia are set — the two fields that gate
  //       persistMessage's early-return check.
  if (messages.length > 0) {
    const sample = messages[messages.length - 1]; // most-recent
    emit('backfill_msg_sample', {
      groupName,
      keys: Object.keys(sample).slice(0, 30),
      type: sample.type,
      bodyLen: typeof sample.body === 'string' ? sample.body.length : sample.body,
      isMedia: sample.isMedia,
      hasMedia: sample.hasMedia,
      hasId: !!sample.id,
      hasT: !!sample.t,
    });
  }

  // Persist (most recent N up to targetCount, but oldest-first so chronology is preserved in DB)
  messages = messages.slice(-targetCount);
  let stored = 0;
  let persistErrors = 0;
  let persistSkipped = 0;
  for (const m of messages) {
    try {
      // persistMessage returns early (no-op) for messages with no body and no
      // media — system notifications, reactions, group-join alerts, etc.
      // We count them as skipped rather than stored so a "stored:0" in the
      // logs doesn't hide "fetched:100, but all were system messages".
      await persistMessage(m, groupName);
      // persistMessage returns void whether it stored or skipped.  The only
      // reliable way to distinguish is to re-check the guard it uses itself.
      if (!m.body && !m.isMedia && !m.hasMedia) {
        persistSkipped++;
      } else {
        stored++;
      }
    } catch (err) {
      persistErrors++;
      // Emit the FIRST per-group persist failure verbatim so we can see exactly
      // which DB error is silently killing every store attempt (e.g. "no such
      // table: raw_messages" on a fresh container, or a schema mismatch).
      if (persistErrors <= 3) {
        emit('persist_error', {
          groupName,
          error: err.message,
          msgType: m.type,
          msgBodyLen: typeof m.body === 'string' ? m.body.length : String(m.body),
          nth: persistErrors,
        });
        process.stderr.write(`[bridge] persist_error (${groupName}): ${err.message}\n`);
      }
    }
  }
  if (persistErrors > 0 || persistSkipped > 0) {
    emit('backfill_persist_summary', { groupName, stored, persistErrors, persistSkipped, total: messages.length });
  }
  return stored;
}

const wppconnectConfig = {
  session: userId,
  folderNameToken: authDir, // where session is stored
  headless: true,
  devtools: false,
  useChrome: true,
  debug: false,
  logQR: false, // we capture QR ourselves
  // Keep the QR scannable for 5 min instead of wppconnect's ~60s default.
  // The default fires 'autocloseCalled' and kills the session before a user
  // can realistically open WhatsApp → Linked Devices → scan.
  autoClose: 300000,
  // Raise the per-CDP-call ceiling from puppeteer's default. Backfill's
  // openChat()/getAllMessagesInChat() on a busy group runs a heavy
  // Runtime.callFunctionOn. After the first backfill loads ~1000 messages
  // into the DOM, subsequent backfills' openChat calls can stall >120s
  // (page is slow with thousands of messages). 5 minutes should absorb
  // even heavily-loaded pages.
  // Try both top-level and nested puppeteerOptions variants.
  protocolTimeout: 300_000,
  puppeteerOptions: {
    protocolTimeout: 300_000,
  },
  browserPathExecutable: chromeExec || undefined,
  browserArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-restore-last-session',
    '--disable-session-crashed-bubble',
    '--no-first-run',
    '--no-default-browser-check',
  ],
};

emit('debug_config', { config: { ...wppconnectConfig, puppeteerOptions: '[puppeteerOptions]' } });

wppconnect
  .create({
    ...wppconnectConfig,
    catchQR: (base64Qrimg, asciiQR, attempt, urlCode) => {
      emit('qr', { qr: urlCode, image: base64Qrimg, attempt });
    },
    statusFind: (statusSession) => {
      // Most intermediate statuses are noise — only forward the meaningful ones.
      // 'qrReadSuccess' = user just scanned the QR (between qr and ready)
      // browser/mobile disconnects → tell the server so it can close the modal
      if (statusSession === 'qrReadSuccess' && !qrReadEmitted) {
        qrReadEmitted = true;
        emit('authenticated', {});
      } else if (
        statusSession === 'browserClose' ||
        statusSession === 'desconnectedMobile' ||
        statusSession === 'autocloseCalled'
      ) {
        // 'autocloseCalled' = the QR expired unscanned (wppconnect gave up),
        // which is NOT the same as losing an established connection. Normalize
        // it so the UI can show "QR expired" rather than "connection lost".
        const reason = statusSession === 'autocloseCalled' ? 'qr_timeout' : statusSession;
        emit('disconnected', { reason });
        if (activeClient) activeClient.close().catch(() => {});
        setTimeout(() => process.exit(0), 200);
      }
    },
  })
  .then(async (client) => {
    // This runs only after a full login (either fresh QR scan or restored session).
    activeClient = client;
    const phone = (await client.getHostDevice().catch(() => null))?.id?.user || null;
    emit('ready', { phone });

    // Wire the message listener immediately so we don't miss any incoming
    // messages even before the user explicitly selects groups.  The handler
    // filters against monitoredGroupIds which starts empty (so nothing is
    // stored until start_monitoring is called).
    wireMessageListener();

    // If the user already has selected groups from a previous session, start
    // monitoring them right away.
    await loadMonitoredGroups();
  })
  .catch((err) => {
    emit('error', {
      message: err?.message || String(err),
      stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
    });
    setTimeout(() => process.exit(1), 200);
  });

// Subscribe to Redis-backed command channel so a server instance on a
// different node can still control this bridge (multi-instance deployments).
let _seenCmdSig = new Map();   // dedupe Redis + file delivery within 2s
async function handleCmd(cmd) {
  // Ignore commands queued before this bridge booted — they were meant for a
  // previous incarnation. Without this, a 'disconnect' sent during the
  // dashboard's reconnect flow is picked up by the fresh bridge and kills it.
  if (cmd && typeof cmd.ts === 'number' && cmd.ts < BOOT_TS - CMD_STALE_SKEW_MS) {
    process.stderr.write(`[bridge] ignoring stale cmd '${cmd.cmd}' (ts ${cmd.ts} < boot ${BOOT_TS})\n`);
    return;
  }
  const sig = cmd?.cmd + '|' + (cmd?.ts || '');
  const now = Date.now();
  // Purge expired dedupe entries
  for (const [k, t] of _seenCmdSig) { if (now - t > 5000) _seenCmdSig.delete(k); }
  if (_seenCmdSig.has(sig)) return;
  _seenCmdSig.set(sig, now);
  await dispatchCmd(cmd);
}

if (bridgeBus) {
  bridgeBus.receiveCommands(userId, handleCmd);
}

// Command channel (parent → bridge) — filesystem fallback for dev mode.
setInterval(() => {
  try {
    if (!fs.existsSync(cmdFile)) return;
    const raw = fs.readFileSync(cmdFile, 'utf8').trim();
    fs.unlinkSync(cmdFile);
    if (!raw) return;
    const cmd = JSON.parse(raw);
    cmd.ts = cmd.ts || Date.now();
    handleCmd(cmd);
  } catch (_) {}
}, 500);

// A freshly (re)linked multi-device session streams group history
// asynchronously — the phone pushes each chat's backlog over the next 30–90s.
// Because initiate-qr now force-cleans the Chromium profile (to avoid "could
// not link device"), every manual connect is a brand-new link, so the first
// backfill pass routinely fires BEFORE any history has arrived and harvests 0.
// We re-harvest the groups that came back empty once, after this delay, by
// which point the backlog has normally landed. Persistence is idempotent
// (INSERT OR IGNORE on SQLite, ON CONFLICT DO NOTHING on Postgres), so a retry
// can only fill gaps — it can never duplicate a message.
const BACKFILL_RETRY_DELAY_MS = parseInt(process.env.BACKFILL_RETRY_DELAY_MS) || 60_000;

// Backfill a list of {group_id, group_name} rows. Returns the total stored and
// the subset of rows that harvested nothing (candidates for a delayed retry).
async function backfillGroups(rows, { retry = false } = {}) {
  let total = 0;
  const empty = [];
  for (const r of rows) {
    // 1000 messages per group — aggressive backfill to capture history.
    const n = await withPageLock(() => backfillGroup(r.group_id, r.group_name, 1000));
    total += n;
    if (n === 0) empty.push(r);
    emit('backfill_progress', { groupName: r.group_name, stored: n, retry });
  }
  return { total, empty };
}

// Run a full backfill over the current monitored-groups list. Guarded so that
// overlapping POST /rescrape (or a rescrape landing while start_monitoring is
// still going) don't stack multiple concurrent passes over the same groups —
// which previously fired 3 simultaneous backfills and destroyed each other's
// CDP context ("Promise was collected"). Each group's backfill takes the page
// lock so it never overlaps the get_groups scan either.
function runBackfillBatch(label, startEvent) {
  if (_backfillInFlight) {
    emit('backfill_skipped', { label, reason: 'already_in_flight' });
    process.stderr.write(`[bridge] ${label}: backfill already in flight — skipping\n`);
    return;
  }
  _backfillInFlight = true;
  (async () => {
    const rows = await loadMonitoredGroups();
    emit(startEvent, { groupCount: rows.length });
    const { total, empty } = await backfillGroups(rows);
    emit('backfill_complete', { totalStored: total, groups: rows.length });

    // Retry the groups that harvested 0 — the backlog likely just hadn't synced
    // yet on this fresh link. Hold the in-flight lock across the wait so a
    // concurrent rescrape is de-duped rather than racing us. Bail if the client
    // dropped in the meantime (nothing to harvest from a dead page).
    if (empty.length > 0) {
      emit('backfill_retry_scheduled', { groups: empty.length, delayMs: BACKFILL_RETRY_DELAY_MS });
      process.stderr.write(`[bridge] ${label}: ${empty.length} group(s) empty — retrying in ${BACKFILL_RETRY_DELAY_MS}ms\n`);
      await new Promise(r => setTimeout(r, BACKFILL_RETRY_DELAY_MS));
      if (!activeClient) {
        emit('backfill_warning', { reason: 'retry_skipped', message: 'client disconnected before retry' });
        return;
      }
      const { total: retryTotal } = await backfillGroups(empty, { retry: true });
      emit('backfill_complete', { totalStored: retryTotal, groups: empty.length, retry: true });
    }
  })()
    .catch(err => {
      // Use backfill_warning not 'error'. A top-level 'error' event causes the
      // server to tear the bridge down (orphaning Chromium). Backfill failures
      // are non-fatal — the bridge itself is still alive and healthy.
      emit('backfill_warning', { reason: 'batch_error', message: err.message });
    })
    .finally(() => { _backfillInFlight = false; });
}

async function dispatchCmd(cmd) {
  try {
    if (cmd.cmd === 'disconnect') {
      emit('shutting_down', {});
      if (activeClient) {
        activeClient.close().catch(() => {}).finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    } else if (cmd.cmd === 'rescrape') {
      // Re-run the backfill against the current selected_groups list.
      runBackfillBatch('rescrape', 'rescrape_started');
    } else if (cmd.cmd === 'start_monitoring') {
      // Triggered by the server after the user saves group selection.
      // Reload the selected_groups table and run a backfill for each group.
      runBackfillBatch('start_monitoring', 'monitoring_started');
    } else if (cmd.cmd === 'get_groups') {
      if (!activeClient) {
        // Non-fatal: emitting a top-level 'error' here would tear the client
        // down on the server AND leave getGroups() hanging until its 130s
        // timeout. Return an empty result so the caller resolves immediately.
        process.stderr.write('[bridge] get_groups: client not ready, returning empty\n');
        emit('groups', { groups: [], totalChats: 0, attempts: 0, notReady: true });
        return;
      }
      process.stderr.write('[bridge] get_groups: scan starting\n');
      // wppconnect's chat DB isn't populated the instant `ready` fires — it
      // hydrates over the next 5–30 seconds as the WA Web client syncs.
      // Poll until we see chats, then return the groups.  Up to 90s total.
      (async () => {
        // Per-call timeout: wppconnect's getAllChats() can hang indefinitely when
        // WA Web is still hydrating its internal chat store. Without a timeout the
        // whole polling loop stalls on a single await, defeating the MAX_MS guard.
        const withTimeout = (promise, ms) => Promise.race([
          promise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('fetchChats timeout')), ms)),
        ]);

        // Fetch ONLY groups straight from wppconnect's store. getAllChats()
        // serializes every chat (500+) out of the browser context and routinely
        // hangs past 15s, so its count flaps 0↔N and never stabilizes;
        // listChats({onlyGroups:true}) returns just the groups — far smaller and
        // it settles in seconds.
        const fetchGroupChats = async () => withPageLock(async () => {
          // getAllChats() is the method that actually returns this account's
          // chats on WA Web 2.x — listChats({onlyGroups:true}) came back EMPTY
          // (deploy logs: "first fetch → 0 groups"), and chaining the other
          // methods first just burned a 20s timeout each before reaching
          // getAllChats anyway (the ~60s-per-iteration stall). Call it directly
          // and filter for groups ourselves below.
          // withPageLock: getAllChats is a heavy CDP sweep over ~500 chats; if
          // it runs while a backfill is mid-openChat on the same page, one
          // destroys the other's execution context ("Promise was collected").
          if (typeof activeClient.getAllChats === 'function') {
            try { return (await withTimeout(activeClient.getAllChats(), 25_000)) || []; } catch (_) {}
          }
          if (typeof activeClient.listChats === 'function') {
            try { return (await withTimeout(activeClient.listChats(), 25_000)) || []; } catch (_) {}
          }
          return [];
        });

        const filterGroups = (chats) => chats
          .filter(c =>
            c.isGroup === true ||
            c.kind === 'group' ||
            (c.id && (c.id._serialized || '').endsWith('@g.us')) ||
            (c.id && c.id.server === 'g.us') ||
            !!c.groupMetadata
          )
          .map(c => ({
            id: c.id?._serialized || (typeof c.id === 'string' ? c.id : ''),
            name: c.name || c.formattedTitle || c.contact?.name || c.contact?.pushname || '(unknown)',
            participantCount: c.groupMetadata?.participants?.length || 0,
            lastMessage: (c.lastReceivedKey?.body || c.lastMessage?.body || '').toString().substring(0, 60),
          }))
          .filter(g => g.id);

        const startedAt = Date.now();
        // MAX_MS must stay well under the server's 130s getGroups timeout so the
        // bridge always answers before the server gives up (which surfaced as 500).
        const MAX_MS    = 90_000;
        const STABLE_MS = 10_000;  // group count steady for 10 s → accept
        const MIN_MS    = 8_000;   // always wait at least 8 s for hydration
        let attempts = 0;
        let lastCount = -1;
        let stableSince = 0;
        let best = [];             // largest group set seen — never regress on a transient empty fetch
        while (Date.now() - startedAt < MAX_MS) {
          attempts++;
          const groups = filterGroups(await fetchGroupChats());
          if (groups.length > best.length) best = groups;
          if (attempts === 1) {
            process.stderr.write(`[bridge] get_groups: first fetch → ${groups.length} groups\n`);
          }
          emit('groups_progress', {
            attempt: attempts,
            totalChats: groups.length,
            groupsFound: groups.length,
            elapsedMs: Date.now() - startedAt,
          });
          if (groups.length !== lastCount) {
            // count changed — reset the stability window
            lastCount = groups.length;
            stableSince = Date.now();
          } else if (
            groups.length > 0 &&
            Date.now() - stableSince >= STABLE_MS &&
            Date.now() - startedAt  >= MIN_MS
          ) {
            emit('groups', { groups: best, totalChats: best.length, attempts });
            return;
          }
          // Poll gently: getAllChats() over ~500 chats is heavy, and hammering
          // it every 2s kept the puppeteer page busy enough to slow hydration.
          await new Promise(r => setTimeout(r, 5000));
        }
        // Timed out — return the best set we saw rather than risk a final empty fetch
        emit('groups', { groups: best, totalChats: best.length, attempts, timedOut: true });
      })().catch(err => {
        // A group-scan hiccup must NOT emit a top-level 'error' — that tears the
        // whole client down on the server and leaves getGroups() hanging until
        // its 130s timeout (→ generic 500). Log for diagnosis and return a
        // non-fatal empty result so the caller resolves fast.
        process.stderr.write(`[bridge] get_groups failed: ${err && err.stack ? err.stack : err}\n`);
        emit('groups', { groups: [], totalChats: 0, attempts: 0, error: String((err && err.message) || err), timedOut: true });
      });
    }
  } catch (err) {
    // Non-fatal: a synchronous throw inside a command handler must not emit
    // a top-level 'error' (the server would tear the bridge down and orphan
    // Chromium). Warn instead so the issue is visible without killing the session.
    emit('backfill_warning', { reason: 'dispatch_error', message: err.message });
  }
}

process.stderr.write(`[bridge] PID ${process.pid} started for ${userId} (wppconnect)\n`);
