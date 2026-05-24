module.exports = {
  PROPERTY_TYPES: ['apartment', 'villa', 'plot', 'commercial', 'office', 'pg'],

  SUPPORTED_CITIES: ['mumbai', 'delhi', 'bangalore', 'pune', 'hyderabad'],

  CURRENCY: { symbol: '₹', code: 'INR' },

  CONFIDENCE: {
    EXCELLENT: 0.9,
    GOOD: 0.7,
    FAIR: 0.5,
    POOR: 0.3
  },

  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
  },

  PAGINATION: {
    MIN_LIMIT: 1,
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 500
  }
};
