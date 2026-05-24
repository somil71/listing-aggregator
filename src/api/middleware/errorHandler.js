const ERROR_CODES = require('../utils/errorCodes');
const formatters = require('../utils/formatters');
const AppError = require('../errors/AppError');
const DatabaseError = require('../errors/DatabaseError');
const { errorLogger } = require('./logger');

// Wraps async route handlers so unhandled rejections reach globalErrorHandler
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 404 — called when no route matched
const notFoundHandler = (req, res) => {
  res.status(404).json(
    formatters.error(ERROR_CODES.NOT_FOUND, { path: req.path, method: req.method })
  );
};

// Global error handler — must be registered LAST in server.js
const globalErrorHandler = (err, req, res, next) => {
  errorLogger(err, req);

  // Catch our custom OOP AppErrors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      timestamp: new Date().toISOString()
    });
  }

  // Legacy fallback for formatters/errorCodes
  if (err.errorCode) {
    return res.status(err.errorCode.statusCode).json(
      formatters.error(err.errorCode, err.field ? { field: err.field, message: err.message } : null)
    );
  }

  // SQLite errors mapped to DatabaseError
  if (err.code === 'SQLITE_CANTOPEN' || err.code === 'SQLITE_IOERR') {
    const dbErr = new DatabaseError('Database operation failed');
    return res.status(dbErr.statusCode).json(formatters.error({ code: dbErr.code, message: dbErr.message, statusCode: dbErr.statusCode }));
  }

  // Query timeout
  if (err.message && err.message.includes('timeout')) {
    const dbErr = new DatabaseError('Query timed out', 'QUERY_TIMEOUT', 504);
    return res.status(dbErr.statusCode).json(formatters.error({ code: dbErr.code, message: dbErr.message, statusCode: dbErr.statusCode }));
  }

  // Generic fallback
  const statusCode = err.statusCode || 500;
  const errorCode = { ...ERROR_CODES.INTERNAL_SERVER_ERROR, statusCode };
  const details = process.env.NODE_ENV !== 'production' ? { stack: err.stack } : null;

  res.status(statusCode).json(formatters.error(errorCode, details));
};

module.exports = { asyncHandler, notFoundHandler, globalErrorHandler };
