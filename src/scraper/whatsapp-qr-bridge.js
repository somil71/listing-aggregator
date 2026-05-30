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
  if (!message.body && !message.isMedia) return;

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
  if (parsed.confidence > 0) {
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
      const chatId = message.chatId?._serialized || message.from || '';
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
  try {
    const rows = await dbAll('SELECT group_id, group_name FROM selected_groups WHERE user_id = ?', [userId]);
    monitoredGroupIds = new Set(rows.map(r => r.group_id));
    emit('monitoring', { count: monitoredGroupIds.size });
    return rows;
  } catch (err) {
    emit('error', { message: 'loadMonitoredGroups: ' + err.message });
    return [];
  }
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

  let messages = [];

  // Step 0: WhatsApp Web only fetches a chat's message history when the chat
  // is "opened" (clicked) in the UI.  Without this, loadEarlierMessages is a
  // no-op.  We open the chat and wait briefly for the initial load.
  if (list('openChat')) {
    // openChat occasionally rejects with a transient Puppeteer error
    // ("Protocol error (Runtime.callFunctionOn): Promise was collected")
    // when WhatsApp Web's page context is GC'd mid-call — especially right
    // after a (re)link while the store is still settling. This is NOT a
    // permanent "user left the group" failure, so retry a few times before
    // giving up. Without the retry, an active group can be skipped on every
    // pass and its newest messages never get harvested.
    let opened = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 4 && !opened; attempt++) {
      try {
        await activeClient.openChat(groupId);
        await new Promise(r => setTimeout(r, 2500));
        // Mark as seen to make WA think we're actively viewing the chat
        if (list('sendSeen')) {
          try { await activeClient.sendSeen(groupId); } catch (_) {}
        }
        opened = true;
        emit('backfill_chat_opened', { groupId, groupName, attempt });
      } catch (e) {
        lastErr = e;
        emit('backfill_warning', {
          groupId, groupName, reason: 'open_retry',
          message: `attempt ${attempt}: ${e.message}`,
        });
        // Back off a bit before retrying so the page context can recover.
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!opened) {
      // Exhausted retries. Skip this group's backfill but DO NOT emit 'error'
      // — that would tear the whole modal into a fatal state. Live messages
      // for other groups still flow normally.
      emit('backfill_warning', {
        groupId, groupName, reason: 'open_failed',
        message: lastErr ? lastErr.message : 'unknown',
      });
      return 0;  // can't open the chat at all, nothing to backfill
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
    let prev = -1, stable = 0;
    for (let i = 0; i < 30 && stable < 4; i++) {
      const peek = await activeClient.getAllMessagesInChat(groupId, true, false).catch(() => []);
      if (peek.length === prev) stable++; else { stable = 0; prev = peek.length; }
      await new Promise(r => setTimeout(r, 1000));
    }
    emit('backfill_synced', { groupId, groupName, loaded: prev });
  }

  // Step 1: scroll back through the chat repeatedly to force WA Web to
  // download historical messages from the server.  Now that the chat is
  // open, loadEarlierMessages actually triggers backend fetches.
  try {
    if (list('loadEarlierMessages')) {
      let stable = 0;
      let lastCount = -1;
      for (let i = 0; i < 50 && stable < 4; i++) {
        try {
          const result = await activeClient.loadEarlierMessages(groupId);
          // result is usually an array — empty means "no more to load"
          if (Array.isArray(result) && result.length === 0) stable++;
          else stable = 0;
          // small wait so WA Web can fetch + render
          await new Promise(r => setTimeout(r, 600));
        } catch (e) {
          // some chats reject when at top; treat as "no more"
          stable++;
        }
        // peek at total count so far
        if (list('getAllMessagesInChat')) {
          const peek = await activeClient.getAllMessagesInChat(groupId, true, false).catch(() => []);
          if (peek.length === lastCount) stable++; else stable = 0;
          lastCount = peek.length;
          if (peek.length >= targetCount) break;
        }
      }
      emit('backfill_scrolled', { groupName, attempts: 50, finalCount: lastCount });
    }
  } catch (e) {
    // scroll-load failure is also non-fatal — we still try to harvest
    // whatever's already loaded below.
    emit('backfill_warning', { groupName, reason: 'scroll_failed', message: e.message });
  }

  // Step 2: harvest everything that's now loaded
  if (list('getAllMessagesInChat')) {
    try {
      messages = await activeClient.getAllMessagesInChat(groupId, true, false);
      emit('backfill_loaded', { groupName, method: 'getAllMessagesInChat', count: messages.length });
    } catch (e) {
      emit('backfill_warning', { groupName, reason: 'harvest_failed', message: e.message });
    }
  }

  if (messages.length === 0 && list('loadAndGetAllMessagesInChat')) {
    try {
      messages = await activeClient.loadAndGetAllMessagesInChat(groupId, true, false);
      emit('backfill_loaded', { groupName, method: 'loadAndGetAllMessagesInChat', count: messages.length });
    } catch (e) {
      emit('backfill_warning', { groupName, reason: 'harvest_failed', message: e.message });
    }
  }

  if (messages.length === 0 && list('getMessages')) {
    try {
      messages = await activeClient.getMessages(groupId, { count: targetCount, direction: 'before' });
      emit('backfill_loaded', { groupName, method: 'getMessages', count: messages.length });
    } catch (_) {}
  }

  // Persist (most recent N up to targetCount, but oldest-first so chronology is preserved in DB)
  messages = messages.slice(-targetCount);
  let stored = 0;
  for (const m of messages) {
    try { await persistMessage(m, groupName); stored++; } catch (_) {}
  }
  return stored;
}

wppconnect
  .create({
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
      (async () => {
        const rows = await loadMonitoredGroups();
        emit('rescrape_started', { groupCount: rows.length });
        let total = 0;
        for (const r of rows) {
          const n = await backfillGroup(r.group_id, r.group_name, 1000);
          total += n;
          emit('backfill_progress', { groupName: r.group_name, stored: n });
        }
        emit('backfill_complete', { totalStored: total, groups: rows.length });
      })().catch(err => emit('error', { message: 'rescrape: ' + err.message }));
    } else if (cmd.cmd === 'start_monitoring') {
      // Triggered by the server after the user saves group selection.
      // Reload the selected_groups table and run a backfill for each group.
      (async () => {
        const rows = await loadMonitoredGroups();
        emit('monitoring_started', { groupCount: rows.length });
        let total = 0;
        for (const r of rows) {
          // 1000 messages per group — aggressive backfill to capture history.
          // loadAndGetAllMessagesInChat handles the actual scroll-load logic.
          const n = await backfillGroup(r.group_id, r.group_name, 1000);
          total += n;
          emit('backfill_progress', { groupName: r.group_name, stored: n });
        }
        emit('backfill_complete', { totalStored: total, groups: rows.length });
      })().catch(err => emit('error', { message: 'start_monitoring: ' + err.message }));
    } else if (cmd.cmd === 'get_groups') {
      if (!activeClient) {
        emit('error', { message: 'Client not ready yet' });
        return;
      }
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

        const fetchChats = async () => {
          // Try wppconnect APIs in order of preference, each capped at 15s
          if (typeof activeClient.getAllChats === 'function') {
            try { return await withTimeout(activeClient.getAllChats(), 15_000); } catch (_) {}
          }
          if (typeof activeClient.listChats === 'function') {
            try { return await withTimeout(activeClient.listChats(), 15_000); } catch (_) {}
          }
          return [];
        };

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
        const MAX_MS    = 120_000;  // 2 minutes total — WA Web can be slow to hydrate
        const STABLE_MS = 15_000;  // count must stay identical for 15 s before we accept it
        const MIN_MS    = 10_000;  // always wait at least 10 s even if instantly stable
        let attempts = 0;
        let lastCount = -1;
        let stableSince = 0;
        while (Date.now() - startedAt < MAX_MS) {
          attempts++;
          const raw = await fetchChats();
          const groups = filterGroups(raw);
          emit('groups_progress', {
            attempt: attempts,
            totalChats: raw.length,
            groupsFound: groups.length,
            elapsedMs: Date.now() - startedAt,
          });
          if (raw.length !== lastCount) {
            // count changed — reset stability window
            lastCount = raw.length;
            stableSince = Date.now();
          } else if (
            raw.length > 0 &&
            Date.now() - stableSince >= STABLE_MS &&
            Date.now() - startedAt  >= MIN_MS
          ) {
            // count stable for 15 s AND we've waited at least 10 s — done
            emit('groups', { groups, totalChats: raw.length, attempts });
            return;
          }
          // poll every 2s while syncing (each fetchChats is already capped at 15s)
          await new Promise(r => setTimeout(r, 2000));
        }
        // Timed out — return whatever we have
        const finalRaw = await fetchChats();
        emit('groups', {
          groups: filterGroups(finalRaw),
          totalChats: finalRaw.length,
          attempts,
          timedOut: true,
        });
      })().catch(err => emit('error', { message: 'get_groups: ' + err.message }));
    }
  } catch (err) {
    emit('error', { message: 'dispatchCmd: ' + err.message });
  }
}

process.stderr.write(`[bridge] PID ${process.pid} started for ${userId} (wppconnect)\n`);
