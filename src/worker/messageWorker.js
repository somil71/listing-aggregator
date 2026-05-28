/**
 * DEPRECATED — DO NOT RUN. This worker is incompatible with the current
 * architecture (BullMQ + legacy SQLite schema, neither of which exist
 * anymore). Use src/worker/parseWorker.js for the Upstash queue +
 * multi-tenant Postgres path.
 *
 * TODO(2026-05-28): delete this file after one more release cycle.
 * The package.json scripts that referenced it have already been removed.
 */
throw new Error('messageWorker.js is deprecated. Use src/worker/parseWorker.js instead.');
// eslint-disable-next-line no-unreachable
require('dotenv').config();

const cluster = require('cluster');
const os      = require('os');
const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');

const logger        = require('../config/logger');
const messageParser = require('../scraper/message-parser');
const { dbRun }     = require('../api/db-helpers');
const { moveToDLQ } = require('../queue/messageQueue');
const cacheService  = require('../api/services/cacheService');

const REDIS_URL    = process.env.REDIS_URL;
const CONCURRENCY  = parseInt(process.env.WORKER_CONCURRENCY) || 10;
const NUM_WORKERS  = parseInt(process.env.WORKER_PROCESSES)   || os.cpus().length;

if (!REDIS_URL) {
  console.error('REDIS_URL not set — worker requires Redis. Exiting.');
  process.exit(1);
}

async function processMessage(job) {
  const { messageId, messageText, senderName, groupName, groupId, userId } = job.data;

  // Parse
  const parsed = messageParser.parse(messageText, senderName, groupName);

  // Low-confidence → discard to failed table
  if (parsed.confidence < 0.3) {
    await dbRun(
      `INSERT OR IGNORE INTO listings_failed (id, raw_message_id, user_id, failure_reason, confidence_score)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), messageId, userId, 'confidence_below_threshold', parsed.confidence]
    );
    return { status: 'skipped', reason: 'low_confidence', confidence: parsed.confidence };
  }

  // Store raw message
  await dbRun(
    `INSERT OR IGNORE INTO raw_messages
       (id, user_id, group_id, group_name, message_text, message_timestamp)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [messageId, userId, groupId, groupName, messageText]
  );

  // Store parsed listing
  await dbRun(
    `INSERT OR IGNORE INTO listings
       (id, raw_message_id, user_id, price, location, bedrooms, area_sqft, property_type,
        furnished, agent_name, agent_phone, group_id, group_name, description,
        extraction_confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      messageId, messageId, userId,
      parsed.price        ?? null,
      parsed.location     ?? null,
      parsed.bedrooms     ?? null,
      parsed.area_sqft    ?? null,
      parsed.property_type ?? null,
      parsed.furnished    ?? null,
      parsed.agent_name   ?? null,
      parsed.agent_phone  ?? null,
      groupId, groupName,
      parsed.description  ?? messageText.slice(0, 200),
      parsed.confidence,
    ]
  );

  // Invalidate cache so next API request fetches fresh data
  await cacheService.invalidateListings();

  return { status: 'success', listingId: messageId, confidence: parsed.confidence };
}

// ── Cluster mode (one OS process per CPU core) ───────────────────────────────
if (cluster.isPrimary && NUM_WORKERS > 1) {
  logger.info(`Starting ${NUM_WORKERS} worker processes`);

  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} exited`, { code, signal });
    cluster.fork(); // auto-restart
  });
} else {
  // ── Single worker instance ──────────────────────────────────────────────────
  const worker = new Worker('message-processing', processMessage, {
    connection: { url: REDIS_URL },
    concurrency: CONCURRENCY,
  });

  worker.on('completed', (job, result) => {
    logger.debug('Job completed', { jobId: job.id, ...result });
  });

  worker.on('failed', async (job, err) => {
    logger.error('Job failed', { jobId: job?.id, error: err.message, attempts: job?.attemptsMade });

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      await moveToDLQ(job.data, err.message);
    }
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  logger.info(`Message worker running (pid ${process.pid})`, {
    concurrency: CONCURRENCY,
    redis: REDIS_URL,
  });

  process.on('SIGTERM', async () => {
    logger.info('Worker shutting down...');
    await worker.close();
    process.exit(0);
  });
}
