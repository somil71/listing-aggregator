const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbAll, dbGet } = require('../db-helpers');
const pg = require('../../db/postgres/pool');
const bridgeLease = require('./bridgeLease');
const bridgeBus = require('./bridgeBus');

// Async, cross-platform: kill any Chrome processes holding `authDir` open from
// a previous crashed run. Returns silently if no stale processes exist.
// On non-Windows platforms we use `pkill -f` to match by command line.
// Times out after 5s so a hung pkill/wmic never blocks the QR flow.
async function _killStaleChromeForSession(userId, authDir) {
  const TIMEOUT_MS = 5000;
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(
        'wmic process where "name=\\"chrome.exe\\"" get ProcessId,CommandLine /format:csv',
        { maxBuffer: 10 * 1024 * 1024, timeout: TIMEOUT_MS }
      );
      const escapedAuthDir = authDir.replace(/\\/g, '\\\\');
      const pids = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(escapedAuthDir) && !line.includes(`session-${userId}`)) continue;
        const parts = line.split(',');
        const pid = parts[parts.length - 1].trim();
        if (/^\d+$/.test(pid)) pids.add(pid);
      }
      await Promise.all([...pids].map(pid =>
        execAsync(`taskkill /F /PID ${pid} /T`, { timeout: TIMEOUT_MS }).catch(() => {})
      ));
      if (pids.size) console.log(`[whatsapp] killed ${pids.size} stale Chrome PIDs holding ${userId}'s session`);
    } catch (_) { /* wmic missing or returned no rows → nothing to kill */ }
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    try {
      // pkill matches against the full command line via -f
      await execAsync(`pkill -f ${JSON.stringify(authDir)}`, { timeout: TIMEOUT_MS });
      console.log(`[whatsapp] pkill -f executed for ${userId}'s session`);
    } catch (_) { /* exit 1 = no processes matched, which is fine */ }
  }
  // Other platforms (e.g. BSD): rely on lockfile removal below
}

const DATA_DIR = path.resolve(__dirname, '../../../data');

// Atomic cmd file write: write to .tmp then rename so the bridge never
// reads a partial file if it polls exactly during our write.
function writeCmdAtomic(cmdFile, payload) {
  const tmp = cmdFile + '.tmp';
  // Stamp every command with a wall-clock ts so the bridge can ignore
  // commands that predate its own boot (defeats the disconnect/initiate race).
  if (payload && payload.ts == null) payload = { ...payload, ts: Date.now() };
  fs.writeFileSync(tmp, JSON.stringify(payload));
  try { fs.renameSync(tmp, cmdFile); } catch (_) {
    // On Windows rename can fail if target is locked; fall back to direct write
    try { fs.writeFileSync(cmdFile, JSON.stringify(payload)); } catch (__) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// Resolve the Puppeteer-managed Chrome binary at startup.
// Prefers older/stable Chrome builds that are less likely to trigger
// WhatsApp Web's anti-automation detection ("Execution context was destroyed").
function _resolveChromePath() {
  const fs = require('fs');

  // 1. Explicit env override wins always
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const cacheBase = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.cache', 'puppeteer', 'chrome'
  );

  const _findExe = (dir) => {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome']) {
      const full = path.join(cacheBase, dir, exe);
      if (fs.existsSync(full)) return full;
    }
    return null;
  };

  try {
    const dirs = fs.readdirSync(cacheBase).filter(d => /^(win64|linux)-/.test(d));

    // 2. Prefer Chrome 127 – stable, fully installed, works with whatsapp-web.js 1.34.x
    //    (Chrome 146 was partially extracted due to disk-full and is corrupt)
    const v127 = dirs.find(d => d.includes('-127.'));
    if (v127) { const p = _findExe(v127); if (p) return p; }

    // 3. Fall back to any other version except known-corrupt builds
    const corrupt = ['146.0.7680.165'];
    const others = dirs.filter(d => !corrupt.some(c => d.includes(c)));
    for (const dir of others.reverse()) {
      const p = _findExe(dir);
      if (p) return p;
    }

    // 3. Fall back to any installed version (lowest first = oldest = safest)
    const sorted = dirs.sort();
    for (const dir of sorted) {
      const p = _findExe(dir);
      if (p) return p;
    }
  } catch (_) {}

  return undefined;
}

const CHROME_EXECUTABLE = _resolveChromePath();
console.log('[whatsapp] Chrome executable:', CHROME_EXECUTABLE || '(not found – will try system Chrome)');

class WhatsAppService {
  constructor() {
    this.clients = new Map();       // userId → Client instance
    this.sseConnections = new Map(); // userId → Express res object
    this.lastState = new Map();      // userId → { event, data } (replayed on reconnect)
  }

  // Stop the per-user state-file tailer interval and remove its entry.
  // Idempotent — safe to call from multiple cleanup paths.
  _stopTailer(userId) {
    if (!this._tailers) return;
    const t = this._tailers.get(userId);
    if (t?.stop) {
      try { t.stop(); } catch (_) {}
    }
    this._tailers.delete(userId);
  }

  // ── SSE plumbing ──────────────────────────────────────────────────────────

  registerSSE(userId, res) {
    this.sseConnections.set(userId, res);
    // Replay last known state so a slow-connecting client catches up
    const last = this.lastState.get(userId);
    if (last) this._emit(userId, last.event, last.data);

    // If we're not the instance that owns the bridge, subscribe to the
    // distributed bus so we still see events for this user.  When this
    // instance owns the bridge, we'll see local events via _emit and the
    // Redis subscription is harmless (we de-dupe by event identity).
    if (bridgeBus.isDistributed()) {
      this._busSubs = this._busSubs || new Map();
      if (!this._busSubs.has(userId)) {
        const unsub = bridgeBus.subscribeEvents(userId, (evt) => {
          this._handleBridgeEvent(userId, evt).catch(() => {});
        });
        this._busSubs.set(userId, unsub);

        // Replay recent events so a fresh tab catches up quickly
        bridgeBus.replayRecent(userId, 5000).then(events => {
          for (const evt of events) {
            this._handleBridgeEvent(userId, evt).catch(() => {});
          }
        }).catch(() => {});
      }
    }
  }

  removeSSE(userId) {
    this.sseConnections.delete(userId);
    const unsub = this._busSubs?.get(userId);
    if (unsub) {
      try { unsub(); } catch (_) {}
      this._busSubs.delete(userId);
    }
  }

  _emit(userId, event, data) {
    const res = this.sseConnections.get(userId);
    if (res) {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        // SSE socket already closed by client — clean up and record
        this.sseConnections.delete(userId);
        try {
          const { sseFailuresCounter } = require('../server');
          sseFailuresCounter?.labels({ reason: 'write_error' }).inc();
        } catch (_) {}
      }
    }
    this.lastState.set(userId, { event, data });
  }

  // ── Status queries ────────────────────────────────────────────────────────

  isConnected(userId) {
    // A bridge subprocess existing is NOT enough — it might still be waiting
    // for the user to scan the QR.  Only report connected when the bridge
    // has emitted 'ready'.
    const entry = this.clients.get(userId);
    return !!(entry && entry.ready);
  }

  async getStatus(userId) {
    let session = null;
    let groups  = [];

    // Prefer Postgres (authoritative) — fall back to SQLite on failure
    try {
      session = await pg.dbGet(
        `SELECT ws.status, ws.phone, ws.updated_at
           FROM whatsapp_sessions ws
           JOIN users u ON u.id = ws.user_id
          WHERE u.clerk_user_id = $1`,
        [userId]
      );
      groups = await pg.dbAll(
        `SELECT mg.wa_group_id AS group_id, mg.group_name
           FROM monitored_groups mg
           JOIN users u ON u.id = mg.user_id
          WHERE u.clerk_user_id = $1 AND mg.is_active = true`,
        [userId]
      );
    } catch (_) {
      // Postgres unavailable — fall back to SQLite session data
      session = await dbGet('SELECT * FROM whatsapp_sessions WHERE user_id = ?', [userId]);
      groups  = await dbAll('SELECT * FROM selected_groups WHERE user_id = ?', [userId]);
    }

    return {
      connected: this.isConnected(userId),
      sessionStatus: session?.status || 'none',
      phone: session?.phone || null,
      updatedAt: session?.updated_at || null,
      selectedGroupsCount: groups.length,
      selectedGroups: groups,
    };
  }

  // ── QR initiation (forks a clean subprocess) ──────────────────────────────
  // whatsapp-web.js's Puppeteer crashes ("Execution context was destroyed") when
  // run in-process with our long-lived Express server.  As a child_process.fork()
  // it works fine.  Each user gets their own bridge subprocess.

  async initiateQR(userId) {
    if (this.clients.has(userId)) {
      return { status: 'already_connected', message: 'Already connected' };
    }
    if (!this._initializing) this._initializing = new Set();
    if (this._initializing.has(userId)) {
      return { status: 'initializing', message: 'Already starting…' };
    }

    // Distributed ownership lease — in multi-instance deployments only one
    // instance should ever spawn a Chromium process for a given userId.
    // The lease is Redis-backed when Redis is available; otherwise it
    // degrades to in-process Map (single-instance) and behaves as before.
    const lease = await bridgeLease.acquire(userId);
    if (!lease.acquired) {
      console.log(`[whatsapp] bridge for ${userId} is owned by ${lease.ownerId} (this=${bridgeLease.INSTANCE_ID})`);
      return {
        status: 'owned_by_other',
        message: 'Your WhatsApp session is being served by another instance. Please reconnect.',
        ownerId: lease.ownerId,
      };
    }
    this._initializing.add(userId);

    const authDir = path.join(DATA_DIR, 'wwebjs-auth', userId);

    // Kill any orphan Chrome that might still hold the authDir open from a
    // previous crashed run (lockfile leaks).  Don't wipe the dir though —
    // we want the session to persist across server restarts so the user
    // doesn't re-scan QR every time.
    //
    // Uses async exec so the Express event loop isn't blocked. On Linux we
    // use pkill -f; on Windows we use wmic + taskkill. On any other platform
    // the cleanup is skipped — lockfile removal below is the fallback.
    await _killStaleChromeForSession(userId, authDir).catch((err) => {
      console.warn(`[whatsapp] orphan-Chrome cleanup failed for ${userId}: ${err.message}`);
    });

    // Remove only Chromium SingletonLock files (release the profile without
    // wiping the saved login).  If the saved login is actually corrupt the
    // bridge will throw and we'll wipe + retry below.
    // wppconnect stores the Chromium profile at <folderNameToken>/<session>,
    // i.e. authDir/<userId> (NOT session-<userId>). The lock files live there.
    const profileDir = path.join(authDir, userId);
    const stalePaths = [
      path.join(profileDir, 'SingletonLock'),
      path.join(profileDir, 'SingletonCookie'),
      path.join(profileDir, 'SingletonSocket'),
      path.join(profileDir, 'lockfile'),
    ];
    for (const f of stalePaths) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
    fs.mkdirSync(authDir, { recursive: true });

    const { spawn } = require('child_process');
    const bridgePath = path.resolve(__dirname, '../../scraper/whatsapp-qr-bridge.js');
    const stateDir = path.resolve(__dirname, '../../../data/wwebjs-state');
    fs.mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, `${userId}.jsonl`);
    const cmdFile = path.join(stateDir, `${userId}.cmd`);

    console.log(`[whatsapp] Spawning bridge for ${userId}`);
    // Reset the state file so old events from a prior run aren't re-played
    try { fs.writeFileSync(stateFile, ''); } catch (_) {}
    // Clear any stale command file left by a previous session (e.g. a
    // 'disconnect' from the dashboard's reconnect flow). Otherwise the
    // freshly-spawned bridge polls it on boot and immediately shuts down.
    try { fs.unlinkSync(cmdFile); } catch (_) {}
    try { fs.unlinkSync(cmdFile + '.tmp'); } catch (_) {}
    // Same for the Redis command queue (multi-instance path).
    try { await bridgeBus.clearCommands(userId); } catch (_) {}

    const child = spawn(
      process.execPath,
      [bridgePath, userId, authDir, CHROME_EXECUTABLE || ''],
      {
        // Inherit stderr so bridge "[bridge] qr" debug lines reach our logs.
        stdio: ['ignore', 'ignore', 'inherit'],
        detached: false,
      }
    );

    // Track this so disconnect() and getGroups() can reach it
    this.clients.set(userId, { child, cmdFile });

    // Keep the distributed lease alive for as long as the bridge is running.
    bridgeLease.startRefresh(userId);

    // Lazy metric require — avoids circular dep at module load time
    let _bridgeReconnects = null;
    const incReconnect = () => {
      try {
        if (!_bridgeReconnects) _bridgeReconnects = require('../server').bridgeReconnectsCounter;
        _bridgeReconnects?.inc();
      } catch (_) {}
    };

    child.on('exit', (code) => {
      console.log(`[whatsapp] bridge ${userId} exited code=${code}`);
      this._initializing?.delete(userId);
      this.clients.delete(userId);
      this._stopTailer(userId);
      this.removeSSE(userId); // prevent writes to a dead SSE socket
      bridgeLease.stopRefresh(userId);
      bridgeLease.release(userId).catch(() => {});
      if (code !== 0) incReconnect();    // only count unexpected exits
    });

    child.on('error', (err) => {
      console.error(`[whatsapp] bridge spawn error for ${userId}:`, err.message);
      this._initializing?.delete(userId);
      this.clients.delete(userId);
      this._emit(userId, 'error', { message: `Failed to start bridge: ${err.message}` });
    });

    // Tail the state file – every new line is a bridge event we forward via SSE
    this._tailers = this._tailers || new Map();
    let offset = 0;
    const tick = async () => {
      try {
        if (!fs.existsSync(stateFile)) return;
        const stat = fs.statSync(stateFile);
        if (stat.size <= offset) return;
        const fd = fs.openSync(stateFile, 'r');
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = stat.size;
        const lines = buf.toString('utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          await this._handleBridgeEvent(userId, evt);
        }
      } catch (e) {
        // ignore transient read errors (file may be truncating)
      }
    };
    const interval = setInterval(tick, 250);
    this._tailers.set(userId, { stop: () => clearInterval(interval) });

    return { status: 'initializing', message: 'Starting WhatsApp...' };
  }

  // Forward one bridge event over SSE / persist as needed
  async _handleBridgeEvent(userId, evt) {
    const { type, data = {} } = evt;
    if (type === 'qr') {
      // wppconnect ships a ready-to-use data URL; fall back to generating one
      // ourselves if only the raw QR string is provided (older bridge versions).
      const image = data.image || (data.qr ? await QRCode.toDataURL(data.qr) : null);
      if (!image) return;
      this._emit(userId, 'qr_generated', { image, message: 'Scan with your phone' });
      await dbRun(
        `INSERT OR REPLACE INTO whatsapp_sessions (id, user_id, status, updated_at)
         VALUES (COALESCE((SELECT id FROM whatsapp_sessions WHERE user_id=?),?),?,'qr_ready',CURRENT_TIMESTAMP)`,
        [userId, uuidv4(), userId]
      );
    } else if (type === 'authenticated') {
      this._emit(userId, 'scanning', { message: 'Phone detected! Confirming…' });
    } else if (type === 'ready') {
      this._initializing?.delete(userId);
      // Flip the entry to ready so isConnected() returns true
      const entry = this.clients.get(userId);
      if (entry) entry.ready = true;
      this._emit(userId, 'authenticated', { message: 'Connected!', phone: data.phone });
      await dbRun(
        `INSERT OR REPLACE INTO whatsapp_sessions (id, user_id, status, phone, updated_at)
         VALUES (COALESCE((SELECT id FROM whatsapp_sessions WHERE user_id=?),?),?,'ready',?,CURRENT_TIMESTAMP)`,
        [userId, uuidv4(), userId, data.phone]
      );
      // Pre-warm the group scan so it completes in the background before the
      // user opens the select-groups modal. wppconnect's chat DB needs ~10s to
      // begin hydrating after ready, so we defer the initial scan by 8s.
      // The scan result is cached; the modal's getGroups() call returns instantly.
      setTimeout(() => {
        if (!this.clients.get(userId)?.ready) return; // disconnected in the meantime
        this.getGroups(userId).catch(() => {}); // best-effort; errors are non-fatal
      }, 8000);

      // Resumed session → recover anything missed during downtime. Wait ~10s
      // first so WhatsApp Web has begun streaming the backlog from the phone;
      // backfillGroup then waits for the per-chat sync to settle before
      // harvesting, so the gap messages are captured rather than skipped.
      if (this._autoBackfillPending?.has(userId)) {
        this._autoBackfillPending.delete(userId);
        setTimeout(() => {
          const e = this.clients.get(userId);
          if (!e || !e.ready) return;  // disconnected in the meantime
          console.log(`[whatsapp] auto-backfill after resume for ${userId}`);
          bridgeBus.sendCommand(userId, { cmd: 'rescrape' }).catch(() => {});
          try { writeCmdAtomic(e.cmdFile, { cmd: 'rescrape' }); } catch (_) {}
        }, 10000);
      }
    } else if (type === 'groups_progress') {
      // Forward sync status so the dashboard can show "Syncing chats…" instead
      // of an instant "no groups found" while wppconnect is still hydrating.
      this._emit(userId, 'groups_syncing', {
        attempt: data.attempt,
        totalChats: data.totalChats,
        message: data.totalChats === 0
          ? `Syncing chats from WhatsApp… (attempt ${data.attempt})`
          : `Found ${data.totalChats} chats so far…`,
      });
    } else if (type === 'groups') {
      // Cache so a subsequent getGroups() call (triggered by the groups_detected
      // SSE event on the client) resolves immediately without a second bridge scan.
      this._groupsCache = this._groupsCache || new Map();
      this._groupsCache.set(userId, data.groups);
      this._emit(userId, 'groups_detected', {
        count: data.groups.length,
        totalChats: data.totalChats,
        timedOut: !!data.timedOut,
      });
      this._groupsByUser = this._groupsByUser || new Map();
      const pending = this._groupsByUser.get(userId);
      this._groupsByUser.delete(userId); // clear so next call creates a fresh promise
      if (pending?.resolve) pending.resolve(data.groups);
    } else if (type === 'loading') {
      this._emit(userId, 'scanning', {
        message: `Loading ${data.percent || ''}% ${data.message || ''}`.trim(),
      });
    } else if (type === 'auth_failure') {
      this._emit(userId, 'error', { message: `Auth failed: ${data.message}` });
    } else if (type === 'disconnected') {
      this._stopTailer(userId);
      this.clients.delete(userId);
      this._groupsCache?.delete(userId);
      this._emit(userId, 'disconnected', { reason: data.reason, message: `Disconnected: ${data.reason}` });
    } else if (type === 'error') {
      const raw = String(data.message || 'Unknown error');
      console.error(`[whatsapp] bridge error for ${userId}:`, raw);
      this._initializing?.delete(userId);
      // Clean wppconnect's internal stack-trace noise before forwarding —
      // users should never see "static.whatsapp.net/...js:7" line refs.
      const cleaned = raw
        .replace(/https?:\/\/[^\s)]+/g, '')
        .replace(/[A-Za-z0-9_-]+\.js:\d+(?::\d+)?/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      this._emit(userId, 'error', { message: cleaned, raw });
      this._stopTailer(userId);
      this.clients.delete(userId);
    } else if (type === 'monitoring_started') {
      this._emit(userId, 'monitoring_started', { groupCount: data.groupCount });
      console.log(`[whatsapp] ${userId} now monitoring ${data.groupCount} groups`);
    } else if (type === 'backfill_start') {
      console.log(`[whatsapp] backfill start: ${data.groupName} target=${data.targetCount}`);
    } else if (type === 'backfill_methods') {
      console.log(`[whatsapp] backfill methods for ${data.groupName}:`, JSON.stringify(data.has));
    } else if (type === 'backfill_synced') {
      console.log(`[whatsapp] sync settled for ${data.groupName}: ${data.loaded} messages loaded`);
    } else if (type === 'backfill_scrolled') {
      console.log(`[whatsapp] scroll-loaded ${data.groupName}: ${data.finalCount} messages in chat`);
    } else if (type === 'backfill_loaded') {
      console.log(`[whatsapp] loaded ${data.count} messages from ${data.groupName} via ${data.method}`);
    } else if (type === 'backfill_progress') {
      this._emit(userId, 'backfill_progress', {
        groupName: data.groupName,
        stored: data.stored,
      });
      console.log(`[whatsapp] backfilled ${data.stored} messages from ${data.groupName}`);
    } else if (type === 'backfill_complete') {
      this._emit(userId, 'backfill_complete', {
        totalStored: data.totalStored,
        groups: data.groups,
      });
      console.log(`[whatsapp] backfill complete: ${data.totalStored} messages from ${data.groups} groups`);
    } else if (type === 'listing_stored') {
      // Live notification when the parser extracts a listing from a real-time msg
      this._emit(userId, 'listing_stored', data);
    } else if (type === 'backfill_warning') {
      // Per-group, non-fatal — forward verbatim. The dashboard will log it
      // in the status feed but stays in its current phase (no error UI).
      this._emit(userId, 'backfill_warning', data);
      console.warn(`[whatsapp] backfill warning for ${userId}: ${data.groupName} ${data.reason} — ${data.message}`);
    }
    // boot / shutting_down / listener_wired / monitoring are info-only
  }

  // ── Group management ──────────────────────────────────────────────────────

  async getGroups(userId) {
    const entry = this.clients.get(userId);
    if (!entry) throw new Error('WhatsApp not connected');

    // Return cached result from a recently completed scan immediately.
    this._groupsCache = this._groupsCache || new Map();
    const cached = this._groupsCache.get(userId);
    if (cached) return cached;

    this._groupsByUser = this._groupsByUser || new Map();

    // Deduplication: if a fetch is already in-flight, return the same promise
    // rather than creating a second one (which would never resolve).
    const pending = this._groupsByUser.get(userId);
    if (pending?.promise) return pending.promise;

    this._emit(userId, 'scanning', { message: 'Scanning your chats...' });

    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject  = rej;
      // Bridge polls for up to 120s (MAX_MS in the bridge) — give it 130s
      // before we give up so the bridge always gets a chance to resolve first.
      setTimeout(() => {
        if (this._groupsByUser.get(userId)?.promise === promise) {
          this._groupsByUser.delete(userId);
        }
        rej(new Error('Group fetch timed out'));
      }, 130_000);
    });

    this._groupsByUser.set(userId, { promise, resolve, reject });

    // Send via Redis when available; fall back to atomic file write for
    // single-instance dev mode.
    try {
      await bridgeBus.sendCommand(userId, { cmd: 'get_groups' });
      writeCmdAtomic(entry.cmdFile, { cmd: 'get_groups' });
    } catch (_) {}
    return promise;
  }

  async selectGroups(userId, groupIds, groupNames = []) {
    const entry = this.clients.get(userId);
    if (!entry) throw new Error('WhatsApp not connected');

    await dbRun('DELETE FROM selected_groups WHERE user_id = ?', [userId]);
    for (let i = 0; i < groupIds.length; i++) {
      await dbRun(
        `INSERT OR IGNORE INTO selected_groups (id, user_id, group_id, group_name)
         VALUES (?, ?, ?, ?)`,
        [uuidv4(), userId, groupIds[i], groupNames[i] || groupIds[i]]
      );
    }

    // Mirror to Postgres so the REST API and other services can read group info
    try {
      await pg.query(
        `DELETE FROM monitored_groups WHERE user_id = (SELECT id FROM users WHERE clerk_user_id = $1)`,
        [userId]
      );
      for (let i = 0; i < groupIds.length; i++) {
        await pg.query(
          `INSERT INTO monitored_groups (user_id, wa_group_id, group_name)
           SELECT id, $2, $3 FROM users WHERE clerk_user_id = $1
           ON CONFLICT (user_id, wa_group_id) DO UPDATE SET group_name = EXCLUDED.group_name`,
          [userId, groupIds[i], groupNames[i] || groupIds[i]]
        );
      }
    } catch (pgErr) {
      console.warn('[whatsapp] selectGroups Postgres mirror failed:', pgErr.message);
    }

    this._emit(userId, 'groups_saved', {
      count: groupIds.length,
      message: `Monitoring ${groupIds.length} group(s)`,
    });

    // Tell the bridge to start monitoring these groups: reload the table,
    // wire the message listener (if not already), and backfill recent messages.
    try {
      await bridgeBus.sendCommand(userId, { cmd: 'start_monitoring' });
      writeCmdAtomic(entry.cmdFile, { cmd: 'start_monitoring' });
    } catch (err) {
      console.error(`[whatsapp] failed to send start_monitoring cmd: ${err.message}`);
    }

    return { saved: groupIds.length };
  }

  // Re-trigger a fresh backfill against the current selected groups list.
  async rescrape(userId) {
    let entry = this.clients.get(userId);

    // If server restarted, clients map is empty but the bridge process may
    // still be alive. Reconstruct the cmdFile path (deterministic from userId)
    // and reattach by resuming the file-tail so SSE events flow again.
    if (!entry) {
      const stateDir = path.resolve(__dirname, '../../../data/wwebjs-state');
      const stateFile = path.join(stateDir, `${userId}.jsonl`);
      const cmdFile   = path.join(stateDir, `${userId}.cmd`);

      // Check if the bridge wrote something recently (within 10 minutes)
      try {
        const stat = fs.statSync(stateFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > 10 * 60 * 1000) throw new Error('Bridge state file is stale — please reconnect WhatsApp');
      } catch (e) {
        if (e.code === 'ENOENT') throw new Error('WhatsApp not connected');
        throw e;
      }

      // Reattach: create a dummy entry and resume tailing
      entry = { child: null, cmdFile, ready: true };
      this.clients.set(userId, entry);
      this._resumeTail(userId, stateFile);
    }

    try {
      await bridgeBus.sendCommand(userId, { cmd: 'rescrape' });
      writeCmdAtomic(entry.cmdFile, { cmd: 'rescrape' });
    } catch (err) {
      throw new Error('Failed to send rescrape command: ' + err.message);
    }
    return { started: true };
  }

  // Resume tailing a bridge's jsonl file after a server restart.
  _resumeTail(userId, stateFile) {
    this._tailers = this._tailers || new Map();
    if (this._tailers.has(userId)) return; // already tailing

    let lastSize = 0;
    try { lastSize = fs.statSync(stateFile).size; } catch (_) {}

    const interval = setInterval(() => {
      try {
        const size = fs.statSync(stateFile).size;
        if (size <= lastSize) return;
        const buf = Buffer.alloc(size - lastSize);
        const fd  = fs.openSync(stateFile, 'r');
        fs.readSync(fd, buf, 0, buf.length, lastSize);
        fs.closeSync(fd);
        lastSize = size;
        buf.toString('utf8').split('\n').filter(Boolean).forEach(line => {
          try { this._handleBridgeEvent(userId, JSON.parse(line)); } catch (_) {}
        });
      } catch (_) {}
    }, 250);

    this._tailers.set(userId, { stop: () => clearInterval(interval) });
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(userId) {
    const entry = this.clients.get(userId);
    if (entry) {
      try {
        await bridgeBus.sendCommand(userId, { cmd: 'disconnect' });
        writeCmdAtomic(entry.cmdFile, { cmd: 'disconnect' });
      } catch (_) {}
      // Force-kill if the bridge hangs
      setTimeout(() => { try { if (entry.child) entry.child.kill('SIGKILL'); } catch (_) {} }, 3000);
      this.clients.delete(userId);
    }
    this.lastState.delete(userId);
    await dbRun(
      `UPDATE whatsapp_sessions SET status='disconnected', updated_at=CURRENT_TIMESTAMP WHERE user_id=?`,
      [userId]
    );
  }

  // ── Auto-resume on server start ──────────────────────────────────────────
  // After a server restart, the bridge subprocesses are gone but the
  // wppconnect auth tokens are still on disk under data/wwebjs-auth/<userId>.
  // We respawn the bridge for every user with a valid saved profile so they
  // don't have to click "Connect WhatsApp" again. wppconnect detects the
  // saved tokens and skips the QR scan — it goes straight to 'ready' and
  // re-wires the message listener.
  //
  // IMPORTANT: the on-disk profile is the ONLY reliable source of truth here.
  // The whatsapp_sessions row is written to SQLite (via dbRun) and frequently
  // lags reality (e.g. shows 'disconnected' after a crash even though the
  // login is still valid), so we DO NOT gate resume on its status. We scan the
  // auth dir directly and let wppconnect decide if the saved login still works.
  async autoResumeBridges() {
    try {
      const authRoot = path.join(DATA_DIR, 'wwebjs-auth');
      if (!fs.existsSync(authRoot)) {
        console.log('[whatsapp] auto-resume: no auth dir, nothing to restore');
        return { resumed: 0 };
      }

      // Each immediate subdir of wwebjs-auth is a userId. wppconnect stores the
      // Chromium profile at <authDir>/<userId>/<userId>, and a usable profile
      // always has a 'Default' subfolder (holds the WhatsApp Local Storage /
      // IndexedDB that backs the login). Anything without it is an empty/broken
      // shell and would only produce a fresh QR — skip it.
      const candidates = fs.readdirSync(authRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(userId => fs.existsSync(path.join(authRoot, userId, userId, 'Default')));

      if (!candidates.length) {
        console.log('[whatsapp] auto-resume: no saved profiles to restore');
        return { resumed: 0 };
      }

      let resumed = 0;
      for (const userId of candidates) {
        // Don't spawn if we already have a live client for this user
        if (this.clients.has(userId)) continue;

        try {
          console.log(`[whatsapp] auto-resume: spawning bridge for ${userId}`);
          // Mark this session so that, once the bridge reaches 'ready', the
          // server kicks off a one-time backfill. A resumed bridge only
          // captures messages that arrive AFTER it reconnects — anything sent
          // while the server/bridge was down must be recovered explicitly, or
          // it's silently lost until the user manually hits "Refetch chats".
          if (!this._autoBackfillPending) this._autoBackfillPending = new Set();
          this._autoBackfillPending.add(userId);
          await this.initiateQR(userId);
          resumed++;
        } catch (err) {
          console.warn(`[whatsapp] auto-resume failed for ${userId}: ${err.message}`);
        }
      }

      console.log(`[whatsapp] auto-resume: ${resumed}/${candidates.length} bridge(s) restored`);
      return { resumed };
    } catch (err) {
      console.error('[whatsapp] autoResumeBridges error:', err.message);
      return { resumed: 0, error: err.message };
    }
  }
}

module.exports = new WhatsAppService();
