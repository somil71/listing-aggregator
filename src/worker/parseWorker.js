// Parse worker — pulls raw_messages from the Upstash queue, runs them
// through the Groq LLM parser, and writes the result to Postgres `listings`.
//
// Run with: node src/worker/parseWorker.js
// Or set up as a Fly.io machine to run continuously.

require('dotenv').config();
require('../config/tracing');
const queue = require('../queue/upstashClient');
const pg = require('../db/postgres/pool');
const { DualParser } = require('../scraper/dual-parser');
const { MessageParser: RegexParser } = require('../scraper/message-parser');
const { PARSE_QUEUE } = require('../db/dualWrite');

// Used as a fallback to backfill community/area_text when both LLMs miss it
const regexParser = new RegexParser();

const parser = new DualParser();
const WORKER_ID = `worker-${process.pid}@${require('os').hostname()}`;
const POLL_INTERVAL_MS = 1000;
const IDLE_BACKOFF_MS = 5000;

console.log(`[parseWorker] ${WORKER_ID} starting`);
console.log(`  groq enabled: ${parser.enabled}`);
console.log(`  gemini enabled: ${parser.geminiEnabled}`);
console.log(`  queue: ${PARSE_QUEUE}`);

const MAX_ATTEMPTS = parseInt(process.env.PARSE_MAX_ATTEMPTS) || 5;
const RETRY_BACKOFF_MS = parseInt(process.env.PARSE_RETRY_BACKOFF_MS) || 60_000;

// Reaper: a job left in 'processing' has no owner anymore — the worker that
// claimed it crashed / was OOM-killed / lost the box mid-job, so nothing will
// ever move it to 'done' or re-enqueue it. Without this it's a silent black
// hole (one listing never appears, no error). We sweep periodically and re-arm
// such jobs. The threshold must comfortably exceed the longest real job
// (2 LLM calls + 1s throttle ≈ a few seconds) so we never reap a job that is
// genuinely still in flight on another worker.
const STALE_PROCESSING_SEC = parseInt(process.env.PARSE_STALE_PROCESSING_SEC) || 300; // 5 min
const REAP_INTERVAL_MS     = parseInt(process.env.PARSE_REAP_INTERVAL_MS) || 60_000;  // sweep ~1/min
let lastReapAt = 0;

let running = true;
let processed = 0;
let failed = 0;
let dead = 0;

process.on('SIGTERM', () => { running = false; });
process.on('SIGINT',  () => { running = false; });

async function processOne(job) {
  const startedAt = Date.now();
  await pg.dbRun(
    `INSERT INTO parse_jobs (raw_message_id, status, attempts, worker_id)
     VALUES ($1, 'processing', 1, $2)
     ON CONFLICT (raw_message_id) DO UPDATE
       SET status = 'processing', attempts = parse_jobs.attempts + 1,
           worker_id = EXCLUDED.worker_id, updated_at = NOW()`,
    [job.raw_id, WORKER_ID]
  );

  // Look up the user_id and group_name from the raw_messages row
  const raw = await pg.dbGet(
    `SELECT r.user_id, r.text, r.sender_name, r.ts_received,
            r.wa_group_id, mg.group_name
       FROM raw_messages r
       LEFT JOIN monitored_groups mg
         ON mg.user_id = r.user_id AND mg.wa_group_id = r.wa_group_id
      WHERE r.id = $1`,
    [job.raw_id]
  );
  if (!raw) {
    console.warn('[parseWorker] raw_messages row not found:', job.raw_id);
    return;
  }

  const text = raw.text || job.text || '';
  const parsed = await parser.parse(text, raw.sender_name);

  // Deterministic post-LLM normalization (location validation/repair + price /
  // furnished / amenity backfill). Shared with the batch reprocess tool so the
  // live path and a re-run produce identical results. See MessageParser.normalize.
  regexParser.normalize(parsed, text);

  // UPSERT (not DO NOTHING): re-running a raw_message through an improved parser
  // must update the existing listing — that's what makes `ops/reprocess.js`
  // possible without hand-written DB scripts. raw_message_id, user_id and
  // ts_listed are identity/source columns and are intentionally NOT overwritten.
  await pg.query(
    `INSERT INTO listings
       (user_id, raw_message_id, wa_group_id, group_name,
        intent, property_type, unit_type, bedrooms, bathrooms,
        area_sqft, area_sqm, furnished, vacant, amenities,
        price, currency, rent_period,
        area_text, community,
        agent_name, agent_phone,
        confidence, extracted_by, raw_llm_json, description, ts_listed)
     VALUES ($1,$2,$3,$4, $5,$6,$7,$8,$9, $10,$11,$12,$13,$14,
             $15,$16,$17, $18,$19, $20,$21, $22,$23,$24,$25,$26)
     ON CONFLICT (raw_message_id) DO UPDATE SET
       wa_group_id   = EXCLUDED.wa_group_id,
       group_name    = EXCLUDED.group_name,
       intent        = EXCLUDED.intent,
       property_type = EXCLUDED.property_type,
       unit_type     = EXCLUDED.unit_type,
       bedrooms      = EXCLUDED.bedrooms,
       bathrooms     = EXCLUDED.bathrooms,
       area_sqft     = EXCLUDED.area_sqft,
       area_sqm      = EXCLUDED.area_sqm,
       furnished     = EXCLUDED.furnished,
       vacant        = EXCLUDED.vacant,
       amenities     = EXCLUDED.amenities,
       price         = EXCLUDED.price,
       currency      = EXCLUDED.currency,
       rent_period   = EXCLUDED.rent_period,
       area_text     = EXCLUDED.area_text,
       community     = EXCLUDED.community,
       agent_name    = EXCLUDED.agent_name,
       agent_phone   = EXCLUDED.agent_phone,
       confidence    = EXCLUDED.confidence,
       extracted_by  = EXCLUDED.extracted_by,
       raw_llm_json  = EXCLUDED.raw_llm_json,
       description   = EXCLUDED.description,
       updated_at    = NOW()`,
    [
      raw.user_id, job.raw_id, raw.wa_group_id, raw.group_name || job.group_name,
      parsed.intent || null,
      parsed.property_type || null,
      parsed.unit_type || null,                             // NEW: 'BHK'|'RK'|'BK'|'BR'|null
      parsed.bedrooms ?? null,
      parsed.bathrooms ?? null,
      parsed.area_sqft ?? null,
      parsed.area_sqm ?? null,
      parsed.furnished || null,                             // already canonical TEXT from _normFurnished
      parsed.vacant ?? null,
      parsed.amenities || [],
      parsed.price ?? null,
      parsed.currency ?? null,
      parsed.rent_period || null,
      parsed.area_text  || parsed.location || null,
      parsed.community  || parsed.location || null,
      parsed.agent_name || null,
      parsed.agent_phone || null,
      parsed.confidence ?? 0,
      parsed.extracted_by || 'unknown',
      parsed.raw_llm_json ? JSON.stringify(parsed.raw_llm_json) : null,
      parsed.description || null,
      raw.ts_received,
    ]
  );

  await pg.dbRun(
    `UPDATE parse_jobs SET status = 'done', completed_at = NOW()
       WHERE raw_message_id = $1`,
    [job.raw_id]
  );

  processed++;
  if (processed % 25 === 0) {
    console.log(`[parseWorker] processed=${processed} failed=${failed} backlog=${await queue.queueLength(PARSE_QUEUE)}`);
  }
  return Date.now() - startedAt;
}

// Re-arm jobs abandoned in 'processing' by a dead worker. The UPDATE atomically
// claims them (a row stops being 'processing' the instant one worker's UPDATE
// commits, so a second worker's identical UPDATE returns it nothing) — safe to
// run from every worker concurrently. Jobs that have already burned through
// MAX_ATTEMPTS are dead-lettered instead of looping forever.
async function reapStuckJobs() {
  const stuck = await pg.dbAll(
    `UPDATE parse_jobs
        SET status      = CASE WHEN attempts >= $2 THEN 'dead' ELSE 'pending' END,
            dead_at     = CASE WHEN attempts >= $2 THEN NOW() ELSE dead_at END,
            dead_reason = CASE WHEN attempts >= $2
                            THEN 'Reaped: stuck in processing, attempts exhausted (' || attempts || ')'
                            ELSE dead_reason END,
            last_error  = COALESCE(last_error, 'worker died mid-job (reaped from processing)'),
            updated_at  = NOW()
      WHERE status = 'processing'
        AND COALESCE(updated_at, created_at) < NOW() - make_interval(secs => $1)
      RETURNING raw_message_id, status, attempts`,
    [STALE_PROCESSING_SEC, MAX_ATTEMPTS]
  );
  if (!stuck.length) return;

  const requeue = stuck.filter(s => s.status === 'pending');
  const deadNow = stuck.length - requeue.length;
  for (const s of requeue) {
    // Rebuild the same payload shape the live producer enqueues. processOne only
    // strictly needs raw_id (it re-reads raw_messages), but we mirror the full
    // shape so a reaped job is indistinguishable from a fresh one.
    const r = await pg.dbGet(
      `SELECT r.id AS raw_id, r.text, r.sender_name, r.wa_group_id, r.ts_received,
              mg.group_name
         FROM raw_messages r
         LEFT JOIN monitored_groups mg
           ON mg.user_id = r.user_id AND mg.wa_group_id = r.wa_group_id
        WHERE r.id = $1`,
      [s.raw_message_id]
    );
    if (!r) continue;
    await queue.enqueue(PARSE_QUEUE, {
      raw_id: r.raw_id, text: r.text, sender_name: r.sender_name,
      wa_group_id: r.wa_group_id, group_name: r.group_name, ts_received: r.ts_received,
    });
  }
  console.warn(`[parseWorker] reaper: re-enqueued ${requeue.length} stale job(s)` +
               (deadNow ? `, dead-lettered ${deadNow} (attempts exhausted)` : ''));
}

async function loop() {
  while (running) {
    // Periodic sweep for jobs orphaned by a crashed worker. Runs even on an idle
    // queue (BRPOP returns null every 5s) so recovery doesn't wait for traffic.
    if (Date.now() - lastReapAt > REAP_INTERVAL_MS) {
      lastReapAt = Date.now();
      try { await reapStuckJobs(); }
      catch (e) { console.warn('[parseWorker] reaper error:', e.message); }
    }

    let job = null;
    try {
      // BRPOP blocks up to 5s waiting for work — replaces the rpop + sleep
      // polling pattern that burned ~720 REST calls/hour on an empty queue.
      job = await queue.dequeueBlocking(PARSE_QUEUE, 5);
    } catch (err) {
      console.warn('[parseWorker] dequeue error:', err.message);
      await sleep(IDLE_BACKOFF_MS);
      continue;
    }

    if (!job) {
      // brpop already waited 5s — go straight back to the next BRPOP, no sleep
      continue;
    }

    try {
      await processOne(job);
    } catch (err) {
      failed++;
      console.error('[parseWorker] processOne failed:', err.message);
      try {
        // Record the failure and increment attempts.
        const updated = await pg.dbGet(
          `INSERT INTO parse_jobs
             (raw_message_id, status, attempts, worker_id, last_error, first_attempt_at)
           VALUES ($1, 'failed', 1, $2, $3, NOW())
           ON CONFLICT (raw_message_id) DO UPDATE
             SET status = 'failed',
                 attempts = parse_jobs.attempts + 1,
                 last_error = EXCLUDED.last_error,
                 updated_at = NOW()
           RETURNING attempts`,
          [job.raw_id, WORKER_ID, err.message.slice(0, 500)]
        );

        const attempts = updated?.attempts ?? 1;

        if (attempts >= MAX_ATTEMPTS) {
          // Promote to dead letter — leave it in parse_jobs for inspection,
          // do NOT re-enqueue. An operator can manually requeue later.
          await pg.query(
            `UPDATE parse_jobs
                SET status = 'dead',
                    dead_at = NOW(),
                    dead_reason = $2,
                    updated_at = NOW()
              WHERE raw_message_id = $1`,
            [job.raw_id, `Exhausted ${MAX_ATTEMPTS} attempts: ${err.message.slice(0, 200)}`]
          );
          dead++;
          console.warn(`[parseWorker] job ${job.raw_id} dead-lettered after ${attempts} attempts`);
        } else {
          // Re-enqueue with simple exponential backoff using sleep before next pop.
          // (Upstash REST doesn't support delayed delivery natively; we'd switch
          // to BullMQ for proper delayed jobs — see backlog item #4.)
          const backoff = Math.min(RETRY_BACKOFF_MS * Math.pow(2, attempts - 1), 15 * 60_000);
          setTimeout(() => {
            queue.enqueue(PARSE_QUEUE, job).catch(e =>
              console.warn(`[parseWorker] re-enqueue failed for ${job.raw_id}: ${e.message}`)
            );
          }, backoff).unref();
          console.warn(`[parseWorker] job ${job.raw_id} re-enqueue in ${backoff}ms (attempt ${attempts}/${MAX_ATTEMPTS})`);
        }
      } catch (e) {
        console.warn(`[parseWorker] failed-state bookkeeping error: ${e.message}`);
      }
    }

    // Throttle inter-job to respect Groq's 30 req/min total + token cap
    await sleep(POLL_INTERVAL_MS);
  }

  console.log(`[parseWorker] shutting down. processed=${processed} failed=${failed} dead=${dead}`);
  await pg.close().catch(() => {});
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

loop().catch(err => {
  console.error('[parseWorker] fatal:', err);
  process.exit(1);
});
