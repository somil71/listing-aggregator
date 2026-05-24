const express = require('express');
const { getConnection } = require('../../db/connection');
const queries = require('../../db/queries');
const formatters = require('../utils/formatters');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const db = getConnection();
  
  if (!db.isConnected()) {
    return res.status(503).json(formatters.error({
      statusCode: 503,
      code: 'DATABASE_DISCONNECTED',
      message: 'Database is not connected'
    }));
  }

  try {
    // Run concurrent checks
    const [ping, countResult] = await Promise.all([
      db.get(queries.health.ping),
      db.get(queries.health.listingCount)
    ]);

    res.json(formatters.success({
      status: 'healthy',
      uptime: process.uptime(),
      database: {
        connected: true,
        ping: ping?.ok === 1,
        total_listings: countResult?.count || 0
      },
      memory: {
        used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    }, 'System healthy'));
  } catch (err) {
    res.status(503).json(formatters.error({
      statusCode: 503,
      code: 'HEALTHCHECK_FAILED',
      message: 'System healthcheck failed'
    }, { details: err.message }));
  }
}));

module.exports = router;
