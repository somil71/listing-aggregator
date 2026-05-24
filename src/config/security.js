module.exports = {
  // CORS settings
  cors: {
    // In production set CORS_ORIGIN env var to your actual domain
    origin: process.env.CORS_ORIGIN || '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  },

  // General rate limiting — 200 requests per 15 min per IP
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' }
  },

  // Stricter rate limit for search (expensive queries)
  searchRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many search requests, please slow down.' }
  },

  // Helmet CSP — allow inline styles for the React dashboard
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:']
      }
    }
  }
};
