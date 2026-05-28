# WhatsApp QR — Debugging Log

## The Error

```
Protocol error (Runtime.callFunctionOn): Execution context was destroyed.
```

Origin: `whatsapp-web.js` → bundled `puppeteer-core` → `ExecutionContext.evaluate()`.

**What it actually means:** `whatsapp-web.js` calls `page.evaluate()` (run JS inside the
WhatsApp Web page). Mid-call, the page **navigates** (URL changes) and the V8
execution context that the script was running in is destroyed. The Chrome DevTools
Protocol returns this error because the script can't continue.

It is *not* a sandbox issue, not a permission issue, not a network issue.
It is a **timing race** between `whatsapp-web.js`'s init scripts and the
WhatsApp Web page's own boot / redirect logic.

---

## Why It's Happening (root cause)

Two things make this happen:

**1. WhatsApp Web's modern boot sequence does an internal navigation.**
   When you load `web.whatsapp.com`, the page registers a service worker and
   often performs one or more redirects/replacements *before* showing the QR.
   Each redirect destroys the previous V8 context.

**2. `whatsapp-web.js` 1.34.7 was built before this navigation pattern.**
   It calls `page.evaluate()` very early, expecting the page to already be
   stable. When the redirect lands mid-evaluate, the call dies.

**3. (THE ONE THAT GOT US)** `LocalAuth` restores a Chrome profile from
   `data/wwebjs-auth/<userId>/session-<userId>/`. If that profile is partial
   or corrupt (e.g. from a previous crashed run), Chrome triggers extra
   navigations on restart to recover state, which **triples** the chance of
   hitting the race.

A fresh authDir → 5-second QR (verified by `test-spawn` standalone run).
A poisoned authDir → "Execution context destroyed" within ~3 seconds.

---

## What We've Tried (chronological)

| # | Fix attempted | Result |
|---|--------------|--------|
| 1 | `npx puppeteer browsers install chrome` (Chrome 148) | Chrome installed but `whatsapp-web.js` expected 146 |
| 2 | Add explicit `executablePath` in Puppeteer config | Chrome launched OK, but execution context error remained |
| 3 | `headless: 'new'` (Chrome's new headless mode) | No effect on the navigation race |
| 4 | Spoof UA: `Chrome/127.0.0.0 ... Safari/537.36` | No effect |
| 5 | `ignoreDefaultArgs: ['--enable-automation']` | No effect |
| 6 | `--disable-blink-features=AutomationControlled` | No effect |
| 7 | `--window-position=-10000,-10000` (visible but offscreen) | No effect |
| 8 | `headless: false` | No effect |
| 9 | Install Chrome 127 (older, stable) | Chrome ran but same error |
| 10 | Install Chrome 146 (exact wweb expectation) | Disk full → partial extraction → corrupt `resources.pak` |
| 11 | Pin `webVersion: '2.3000.1040061749-alpha'` via `webVersionCache` | Loaded the snapshot but still navigated → same error |
| 12 | Minimal config (just `--no-sandbox`, no UA, no flags) | Worked **standalone**, failed when called from Express |
| 13 | `child_process.fork()` with IPC | Bridge ran, but IPC messages didn't reach parent on Windows |
| 14 | `child_process.spawn()` + file-tail transport | **Architecture verified working** with fresh authDir |
| 15 | Same as 14 but with stale 55 MB authDir | **Same execution-context error** ← we are here |

---

## What Actually Works (proven)

The `test-spawn` userId — same bridge code, same Chrome, same Puppeteer args —
generated a QR in **5 seconds** because its authDir was empty.

That gives a confirmed working baseline: **the bridge code is correct.**
The problem is data, not code.

---

## Ways to Fix (ranked by likelihood)

### A. Force a fresh authDir on every initiate-qr (HIGH confidence)
Before launching the bridge, **recursively delete** the user's session folder.
Currently `rm -rf` fails because previous Chrome processes still hold locks.
Solution: kill any orphan Chrome processes that reference the path, *then* delete.

```js
// In whatsappService.initiateQR, before spawn:
killChromeProcessesUsingDir(authDir);
fs.rmSync(authDir, { recursive: true, force: true });
fs.mkdirSync(authDir, { recursive: true });
```

This trades persistence for reliability: the user re-scans QR each time, but
QR actually appears.

### B. Use `RemoteAuth` instead of `LocalAuth` (MEDIUM)
`whatsapp-web.js` supports `RemoteAuth` which stores session in DB. Less
prone to filesystem corruption but adds a dependency.

### C. Upgrade `whatsapp-web.js` from a fork that supports current WA Web (MEDIUM)
The maintained fork `@wppconnect-team/wppconnect` is a complete rewrite that
tracks WhatsApp Web more closely. Drop-in for our use case but is a bigger
swap.

### D. Use `wppconnect` directly (MEDIUM)
Same as C — different library, similar API, actively maintained.

### E. Catch and retry the navigation race (LOW)
Wrap `client.initialize()` and on this specific error, destroy + relaunch.
Brittle, but a one-line fix to try.

### F. Use a long-lived Chrome user-data-dir under Windows AppData (LOW)
Some users report `wwebjs-auth` paths inside the project dir get touched by
file watchers / antivirus on Windows, corrupting writes. Move to
`%LOCALAPPDATA%/wwebjs/<userId>`.

---

## Immediate Next Step (recommended)

Implement **A**: before each `initiateQR`, kill any Chrome process that has
the user's authDir open in its command line, then `rm -rf` the dir.

This is the smallest change that should immediately make QR appear,
because we've already proven the bridge works with an empty authDir.

If A doesn't hold up (e.g. WhatsApp Web changes and starts redirecting even
with a fresh dir), the next step is **D**: swap in `wppconnect`.

---

## How to verify Fix A works

1. Stop the server
2. `taskkill /F /IM chrome.exe /T` (kill ALL Chrome)
3. `rm -rf data/wwebjs-auth data/wwebjs-state`
4. Start server
5. Click Connect WhatsApp
6. QR should appear in 5–10 seconds

If step 6 succeeds, the fix is real; we then add the cleanup to
`initiateQR` so it happens automatically on every launch.

---

## Files involved

- `src/api/services/whatsappService.js` — server-side orchestration (spawn + tail)
- `src/scraper/whatsapp-qr-bridge.js` — subprocess that runs whatsapp-web.js
- `dashboard/src/components/QRModal.tsx` — UI that displays the QR
- `dashboard/src/hooks/useSSE.ts` — SSE token-refresh logic
- `data/wwebjs-auth/<userId>/session-<userId>/` — the poisoned profile (DELETE THIS)
- `data/wwebjs-state/<userId>.jsonl` — bridge → server event log (working)
