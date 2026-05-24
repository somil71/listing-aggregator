const logger = require('../../config/logger');

// HTTP request/response logging middleware
const httpLogger = (req, res, next) => {
  const start = Date.now();

  logger.info({
    type: 'HTTP_REQUEST',
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length ? req.query : undefined,
    ip: req.ip
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      type: 'HTTP_RESPONSE',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
};

// Log database queries (call manually from services when needed)
const queryLogger = (sql, duration) => {
  logger.debug({
    type: 'DB_QUERY',
    query: sql.replace(/\s+/g, ' ').trim().substring(0, 120),
    duration: `${duration}ms`
  });
};

// Log errors with full context
const errorLogger = (error, req = null, context = {}) => {
  logger.error({
    type: 'ERROR',
    message: error.message,
    code: error.code || error.errorCode?.code || 'UNKNOWN',
    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    path: req?.path,
    method: req?.method,
    ...context
  });
};

module.exports = { httpLogger, queryLogger, errorLogger };
