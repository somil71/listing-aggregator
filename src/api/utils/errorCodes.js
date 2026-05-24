const ERROR_CODES = {
  // 400 — Validation
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', statusCode: 400, message: 'Invalid request parameters' },
  INVALID_PRICE_RANGE: { code: 'INVALID_PRICE_RANGE', statusCode: 400, message: 'Min price cannot be greater than max price' },
  INVALID_DATE_FORMAT: { code: 'INVALID_DATE_FORMAT', statusCode: 400, message: 'Date must be in YYYY-MM-DD format' },
  MISSING_REQUIRED_FIELD: { code: 'MISSING_REQUIRED_FIELD', statusCode: 400, message: 'Required field missing' },
  SEARCH_QUERY_TOO_SHORT: { code: 'SEARCH_QUERY_TOO_SHORT', statusCode: 400, message: 'Search query must be at least 2 characters' },

  // 404 — Not Found
  NOT_FOUND: { code: 'NOT_FOUND', statusCode: 404, message: 'Resource not found' },
  LISTING_NOT_FOUND: { code: 'LISTING_NOT_FOUND', statusCode: 404, message: 'Listing not found' },

  // 409 — Conflict
  DUPLICATE_ENTRY: { code: 'DUPLICATE_ENTRY', statusCode: 409, message: 'Resource already exists' },

  // 429 — Rate limit
  RATE_LIMITED: { code: 'RATE_LIMITED', statusCode: 429, message: 'Too many requests' },

  // 500 — Server errors
  INTERNAL_SERVER_ERROR: { code: 'INTERNAL_SERVER_ERROR', statusCode: 500, message: 'Internal server error' },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', statusCode: 500, message: 'Database operation failed' },

  // 503 / 504
  QUERY_TIMEOUT: { code: 'QUERY_TIMEOUT', statusCode: 504, message: 'Query timed out' },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: 'Service temporarily unavailable' }
};

module.exports = ERROR_CODES;
