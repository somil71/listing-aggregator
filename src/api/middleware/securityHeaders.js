const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const securityConfig = require('../../config/security');

const corsMiddleware = cors(securityConfig.cors);

const securityHeaders = helmet(securityConfig.helmet);

const apiLimiter = rateLimit(securityConfig.rateLimit);

const searchLimiter = rateLimit(securityConfig.searchRateLimit);

module.exports = { corsMiddleware, securityHeaders, apiLimiter, searchLimiter };
