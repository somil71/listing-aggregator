const envConfig = require('../config/env');
const express = require('express');
const path = require('path');

const appConfig = require('../config/app');
const logger = require('../config/logger');

// Middleware
const { httpLogger, errorLogger } = require('./middleware/logger');
const { corsMiddleware, securityHeaders, apiLimiter, searchLimiter } = require('./middleware/securityHeaders');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

// Routes
const listingsRouter = require('./routes/listings');
const agentsRouter = require('./routes/agents');
const groupsRouter = require('./routes/groups');
const searchRouter = require('./routes/search');
const digestsRouter = require('./routes/digests');
const healthRouter = require('./routes/health');

// Swagger Docs
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./docs/swaggerDef');

// Database
const { getConnection } = require('../db/connection');

const app = express();

// ==================== SETUP ====================
app.set('trust proxy', 1);

// ==================== MIDDLEWARE ====================
app.use(httpLogger);
app.use(securityHeaders);
app.use(corsMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ==================== ROUTES ====================

// Docs
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Health Check
app.use('/health', healthRouter);

// Function to mount routes to support both new and legacy prefixes
const mountRoutes = (prefix) => {
  app.use(`${prefix}/listings`, apiLimiter, listingsRouter);
  app.use(`${prefix}/agents`, apiLimiter, agentsRouter);
  app.use(`${prefix}/groups`, apiLimiter, groupsRouter);
  app.use(`${prefix}/search`, searchLimiter, searchRouter);
  app.use(`${prefix}/digests`, apiLimiter, digestsRouter);
};

// Mount canonical v1 API
mountRoutes(appConfig.apiPrefix);

// Mount legacy API (for backwards compatibility with existing frontend)
mountRoutes(appConfig.legacyPrefix);

// ==================== STATIC FRONTEND ====================
const distPath = path.join(__dirname, '../../dashboard/dist');
app.use(express.static(distPath));

// SPA fallback
app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return notFoundHandler(req, res);
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// ==================== ERROR HANDLING ====================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ==================== STARTUP ====================
const PORT = envConfig.port;
const HOST = envConfig.host;

async function startServer() {
  try {
    const db = getConnection();
    await db.connect();
    logger.info('Database initialized successfully');

    const server = app.listen(PORT, HOST, () => {
      logger.info(`Server running on http://${HOST}:${PORT}`);
      logger.info(`API v1 active at http://${HOST}:${PORT}${appConfig.apiPrefix}`);
      logger.info(`Legacy API active at http://${HOST}:${PORT}${appConfig.legacyPrefix}`);
      logger.info(`Healthcheck active at http://${HOST}:${PORT}/health`);
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        logger.info('Express server closed');
        await db.close();
        process.exit(0);
      });
      
      // Fallback kill after 10s
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', { promise, reason });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

  } catch (error) {
    errorLogger(error, null, { context: 'Server Startup' });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
