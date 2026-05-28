const { Queue, Worker, QueueEvents } = require('bullmq');
const logger = require('../../config/logger');

// Connection config — gracefully skipped if REDIS_URL not set
const redisUrl = process.env.REDIS_URL || null;

let messageQueue = null;
let deadLetterQueue = null;
let queueEvents = null;

if (redisUrl) {
  const connection = { url: redisUrl };

  messageQueue = new Queue('message-processing', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  });

  deadLetterQueue = new Queue('message-dlq', { connection });

  queueEvents = new QueueEvents('message-processing', { connection });

  queueEvents.on('completed', ({ jobId, returnvalue }) => {
    logger.debug('Queue job completed', { jobId, result: returnvalue });
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.warn('Queue job failed', { jobId, reason: failedReason });
  });

  logger.info('BullMQ message queue initialised', { url: redisUrl });
} else {
  logger.info('REDIS_URL not set — BullMQ queue disabled, messages processed inline');
}

/**
 * Add a message to the processing queue.
 * Falls back to direct callback invocation when Redis is unavailable.
 */
async function enqueue(payload, opts = {}) {
  if (messageQueue) {
    return messageQueue.add('process', payload, opts);
  }
  // No-op stub — callers handle inline processing when queue absent
  return null;
}

/**
 * Move a failed job to the dead-letter queue for manual inspection.
 */
async function moveToDLQ(payload, errorMessage) {
  if (deadLetterQueue) {
    await deadLetterQueue.add('dlq', { ...payload, error: errorMessage });
    logger.warn('Job moved to DLQ', { payload, errorMessage });
  }
}

module.exports = {
  messageQueue,
  deadLetterQueue,
  queueEvents,
  enqueue,
  moveToDLQ,
  isEnabled: !!messageQueue,
};
