// Upstash Redis (REST API — works from any environment including Cloudflare/Fly).
// Used for parse-job queue, rate limiting, ephemeral state.

require('dotenv').config();
const { Redis } = require('@upstash/redis');

let client = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
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
