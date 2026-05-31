// Upstash Redis (REST API — works from any environment including Cloudflare/Fly).
// Used for parse-job queue, rate limiting, ephemeral state.

require('dotenv').config();
const { Redis } = require('@upstash/redis');

// Values copied from the Upstash console's "REST" tab arrive as
// `UPSTASH_REDIS_REST_URL="https://..."` — quotes included. If that whole
// string (quotes and all) is pasted into a Railway/host variable, the SDK
// fetches `"https://...` and every call dies with a bare, undiagnosable
// `fetch failed`. Trim surrounding whitespace/newlines and strip one layer of
// matching quotes so a copy-paste with quotes can't silently break the queue.
function cleanEnv(v) {
  if (!v) return v;
  let s = String(v).trim();
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

const REST_URL = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
const REST_TOKEN = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);

let client = null;
if (REST_URL && REST_TOKEN) {
  client = new Redis({ url: REST_URL, token: REST_TOKEN });
  // One-time boot connectivity probe. Turns the worker's cryptic, repeating
  // "dequeue error: fetch failed" into a single actionable line at startup and
  // confirms the queue is actually reachable. Fire-and-forget — never blocks
  // boot, and a failure here is non-fatal because parseWorker falls back to the
  // Postgres direct-poll. The token is never logged; the URL is not a secret.
  client
    .ping()
    .then(() => console.log(`[upstash] connected — ${REST_URL}`))
    .catch((err) =>
      console.error(
        `[upstash] PING failed (${err?.message || err}). Queue unreachable — ` +
          'parseWorker will fall back to Postgres direct-poll. Verify ' +
          'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN on this service ' +
          '(no surrounding quotes, no trailing newline).'
      )
    );
} else {
  console.warn('[upstash] UPSTASH_REDIS_REST_URL/TOKEN not set — queue disabled');
}

// Minimal queue with LPUSH/BRPOP semantics (Upstash REST API).
async function enqueue(queueName, payload) {
  if (!client) return false;
  await client.lpush(queueName, JSON.stringify(payload));
  return true;
}

async function dequeue(queueName) {
  if (!client) return null;
  const raw = await client.rpop(queueName);
  if (raw === null || raw === undefined) return null;
  // Upstash REST client auto-parses JSON when it can; otherwise we get a string.
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

// Blocking dequeue — returns the next job within `timeoutSec` seconds or null.
// Eliminates the busy-polling that rpop+sleep produces: with an empty queue,
// rpop+sleep makes 12 REST calls/min while brpop makes ~1 call per timeout.
//
// Older @upstash/redis releases don't expose .brpop; in that case we fall
// back to a single rpop and let the caller's sleep loop handle pacing.
async function dequeueBlocking(queueName, timeoutSec = 5) {
  if (!client) return null;
  // Polling fallback for SDKs that don't expose BRPOP — sleep timeoutSec
  // on empty queue so we don't burn API calls.
  const pollFallback = async () => {
    const job = await dequeue(queueName);
    if (job) return job;
    await new Promise(r => setTimeout(r, timeoutSec * 1000));
    return null;
  };

  if (typeof client.brpop !== 'function') return pollFallback();

  try {
    const res = await client.brpop(queueName, timeoutSec);
    if (!res) return null;
    const raw = Array.isArray(res) ? res[1] : res?.[queueName];
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return raw; }
  } catch (err) {
    if (/not supported|blocking|not a function/i.test(err.message)) {
      return pollFallback();
    }
    throw err;
  }
}

async function queueLength(queueName) {
  if (!client) return 0;
  return await client.llen(queueName);
}

async function setEx(key, value, seconds) {
  if (!client) return;
  await client.setex(key, seconds, typeof value === 'string' ? value : JSON.stringify(value));
}

async function get(key) {
  if (!client) return null;
  return client.get(key);
}

module.exports = { client, enqueue, dequeue, dequeueBlocking, queueLength, setEx, get };
