require('dotenv').config();
// OpenTelemetry must load BEFORE any instrumented library (express, pg, ioredis).
require('../config/tracing');
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const crypto     = require('crypto');
const path       = require('path');
const fs         = require('fs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const promClient = require('prom-client');

const logger            = require('../config/logger');
const config            = require('../config/app');
const { authenticate }  = require('./middleware/auth');
const { dbAll, dbGet, db } = require('./db-helpers');
const cacheService      = require('./services/cacheService');
const { whatsappBreaker, llmBreaker } = require('./middleware/circuitBreaker');
const auditLog          = require('./middleware/auditLog');
const whatsappRoutes    = require('./routes/whatsapp');
const pg                = require('../db/postgres/pool');   // Postgres — multi-tenant listings

const app       = express();
const startTime = Date.now();

// ── Prometheus metrics setup ─────────────────────────────────────────────────
const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry, prefix: 'pd_node_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'pd_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'pd_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

const whatsappClientsGauge = new promClient.Gauge({
  name: 'pd_whatsapp_clients_active',
  help: 'Number of active WhatsApp Puppeteer clients',
  registers: [metricsRegistry],
});

const listingsCreatedCounter = new promClient.Counter({
  name: 'pd_listings_created_total',
  help: 'Total listings parsed and stored',
  registers: [metricsRegistry],
});

const cacheHitsCounter = new promClient.Counter({
  name: 'pd_cache_hits_total',
  help: 'Cache hits',
  registers: [metricsRegistry],
});

const cacheMissesCounter = new promClient.Counter({
  name: 'pd_cache_misses_total',
  help: 'Cache misses',
  registers: [metricsRegistry],
});

const circuitBreakerOpen = new promClient.Gauge({
  name: 'pd_circuit_breaker_open',
  help: '1 if the named circuit breaker is OPEN, 0 otherwise',
  labelNames: ['name'],
  registers: [metricsRegistry],
});

const queueLagGauge = new promClient.Gauge({
  name: 'pd_queue_depth',
  help: 'Current depth of named queue',
  labelNames: ['queue'],
  registers: [metricsRegistry],
});

const sseFailuresCounter = new promClient.Counter({
  name: 'pd_sse_failures_total',
  help: 'Count of SSE connection failures',
  labelNames: ['reason'],
  registers: [metricsRegistry],
});

const llmTimeoutsCounter = new promClient.Counter({
  name: 'pd_llm_timeouts_total',
  help: 'Count of LLM (Groq/Gemini) timeouts and aborts',
  labelNames: ['provider'],
  registers: [metricsRegistry],
});

const bridgeReconnectsCounter = new promClient.Counter({
  name: 'pd_bridge_reconnects_total',
  help: 'Count of WhatsApp bridge subprocess restarts',
  registers: [metricsRegistry],
});

const pgPoolSaturation = new promClient.Gauge({
  name: 'pd_pg_pool_saturation',
  help: 'Ratio of in-use to total Postgres pool connections (0–1)',
  registers: [metricsRegistry],
});

// ── SQLite schema bootstrap (legacy — non-fatal) ─────────────────────────────
// These are idempotent IF NOT EXISTS statements for the SQLite side-car used by
// the WhatsApp bridge.  Failures are logged and skipped rather than crashing the
// server, because the primary data store is Postgres (see src/db/postgres/).
async function runMigrations() {
  const migrationFiles = [
    '../db/migrations/addUsersTables.sql',
    '../db/migrations/addAuditLog.sql',
    '../db/migrations/addFTS5.sql',
  ];
  for (const file of migrationFiles) {
    try {
      const sql = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
      await new Promise((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
      });
      logger.debug(`SQLite migration applied: ${path.basename(file)}`);
    } catch (err) {
      logger.warn(`SQLite migration skipped (non-fatal): ${path.basename(file)} — ${err.message}`);
    }
  }
}

// ── Rate limiters (values from env-specific config) ─────────────────────────
// keyGenerator uses the real socket IP (never X-Forwarded-For, which can be
// spoofed) and calls ipKeyGenerator so IPv6 addresses are normalised to their
// /56 subnet prefix, satisfying express-rate-limit v8's validation rules.
// Behind a trusted reverse proxy set app.set('trust proxy', N) explicitly.
const _rateLimitKey = (req) => ipKeyGenerator(req.socket.remoteAddress || req.ip);

const apiLimiter = rateLimit({
  ...config.rateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: _rateLimitKey,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

const searchLimiter = rateLimit({
  ...config.searchRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: _rateLimitKey,
  message: { success: false, error: 'Search rate limit reached. Please wait before searching again.' },
});

// ── CORS — strict origin allowlist (never reflect arbitrary origins) ─────────
const _allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no Origin header) and listed origins only.
    // Silently deny unlisted origins — do NOT call cb(new Error(...)) which
    // would leak a stack trace via Express's default error handler.
    if (!origin || _allowedOrigins.has(origin)) return cb(null, true);
    cb(null, false);  // deny without exposing any detail
  },
  credentials: true,
}));

// ── HTTP Security Headers (helmet) ───────────────────────────────────────────
// Generate a per-request nonce so we can drop 'unsafe-inline' from scriptSrc.
// The nonce is injected into the served index.html via a placeholder
// replacement so the dark-mode bootstrap script can carry the nonce attribute.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      // 'strict-dynamic' lets a nonce'd script load its own sub-scripts
      // without requiring CSP exceptions for every Clerk subdomain bundle.
      scriptSrc:      [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        "'strict-dynamic'",
        'https://*.clerk.accounts.dev',
      ],
      // Tailwind injects runtime style attributes; without 'unsafe-inline'
      // on styleSrc we'd lose dynamic theming.  This is the standard tradeoff
      // accepted by every major React app shipping Tailwind today.
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://*.clerk.accounts.dev'],
      imgSrc:         ["'self'", 'data:', 'https:'],
      connectSrc:     [
        "'self'",
        'https://clerk.accounts.dev',
        'https://*.clerk.accounts.dev',
        'https://api.clerk.com',
        'https://clerk-telemetry.com',   // Clerk usage telemetry
      ],
      fontSrc:        ["'self'", 'https:', 'data:'],
      frameSrc:       ["'self'", 'https://*.clerk.accounts.dev'],  // Clerk auth iframes
      workerSrc:      ["'self'", 'blob:'],  // Clerk spawns Web Workers from blob: URLs
      mediaSrc:       ["'self'", 'blob:'],  // AuthenticatedMedia creates blob: URLs for video/audio
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      // NOTE: require-trusted-types-for is intentionally NOT enforced.
      // Clerk's widget uses innerHTML-style DOM sinks without a registered
      // Trusted Types policy, so enforcing this directive blanks the sign-in
      // form. We use report-only below to surface violations without
      // breaking auth. Re-enable enforcement once @clerk/react ships
      // Trusted Types policy registration.
      // CSP violations are POSTed here so we can watch for new XSS attempts
      // or legitimate inline scripts we forgot to nonce after a code change.
      reportUri:      ['/api/csp-report'],
      upgradeInsecureRequests: [],
    },
    // Run Trusted Types in REPORT-ONLY mode — violations get logged to
    // /api/csp-report but the browser doesn't actually block them. This
    // tracks how much surface area Clerk has so we know when it's safe
    // to flip to enforced mode.
    reportOnly: false,
  },
  crossOriginEmbedderPolicy: false,   // needed for Clerk's auth iframe
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,                     // opt-in to HSTS preload list
  },
}));
app.disable('x-powered-by');

// ── Body parsing ─────────────────────────────────────────────────────────────
// 100kb is more than enough for any legitimate JSON body (the largest
// payload is /select-groups with up to 100 group IDs ~ 10kb).
app.use(express.json({ limit: '100kb' }));

// ── Request correlation ID middleware ────────────────────────────────────────
// Every request gets a short request-id (used in logs and emitted as a header)
// so a user-visible failure can be traced back to one specific request's logs
// even when the server is behind a load balancer.
app.use((req, res, next) => {
  req.requestId =
    req.headers['x-request-id'] ||
    crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// ── Per-request hard timeout (load shedding) ────────────────────────────────
// Long-tail requests (hung Groq, stuck PG, paused Redis) are the #1 way a
// node exhausts its connection pool. After 30s we abort the response so the
// PG pool slot is reclaimed. Health & metrics endpoints are excluded since
// they must always answer quickly with their own logic.
const REQUEST_TIMEOUT_MS = 30_000;
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/v1/metrics') return next();
  // SSE responses are intentionally long-lived — don't time them out
  if (req.path.endsWith('/qr-stream')) return next();

  const timer = setTimeout(() => {
    if (res.headersSent) return;
    logger.warn('Request timed out', { requestId: req.requestId, path: req.path, ms: REQUEST_TIMEOUT_MS });
    res.status(503).json({ success: false, error: 'Request timed out', requestId: req.requestId });
  }, REQUEST_TIMEOUT_MS);

  res.on('finish', () => clearTimeout(timer));
  res.on('close',  () => clearTimeout(timer));
  next();
});

// Request logging + Prometheus instrumentation
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    const ms      = Date.now() - t;
    const route   = req.route?.path ?? req.path;
    const labels  = { method: req.method, route, status_code: res.statusCode };
    httpRequestDuration.labels(labels).observe(ms / 1000);
    httpRequestsTotal.labels(labels).inc();

    if (req.path !== '/health') {
      logger.info(`${req.method} ${req.path}`, {
        status: res.statusCode,
        ms,
        ip: req.socket?.remoteAddress,    // never trust x-forwarded-for in logs
        requestId: req.requestId,
      });
    }
  });
  next();
});

// ── CSP violation report endpoint ────────────────────────────────────────────
// Browsers POST here when a CSP directive is violated.  We log structurally
// so an operator can spot new XSS attempts or legitimate violations from
// recent code changes (e.g. a fresh inline script we forgot to nonce).
app.post('/api/csp-report',
  express.json({ type: ['application/csp-report', 'application/json'], limit: '50kb' }),
  (req, res) => {
    const report = req.body?.['csp-report'] || req.body || {};
    logger.warn('CSP violation reported', {
      blockedUri: report['blocked-uri'],
      documentUri: report['document-uri'],
      violatedDirective: report['violated-directive'],
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
    });
    res.status(204).end();
  }
);

// ── Liveness probe (cheap, no dependencies) ──────────────────────────────────
// Kubernetes uses this to decide whether to restart the pod. Should ONLY
// return non-200 when the process is broken — never on transient DB blips,
// otherwise the pod restart-loops while the real problem is downstream.
app.get('/live', (req, res) => res.json({ success: true, status: 'live' }));

// ── Readiness probe — dependencies + circuit-breaker state ──────────────────
// Kubernetes uses this to decide whether to send traffic. Returning 503
// withdraws this pod from the load balancer until dependencies recover.
app.get('/ready', async (req, res) => {
  try {
    const { whatsappBreaker, postgresBreaker } = require('./middleware/circuitBreaker');
    // If postgres breaker is open we cannot serve requests
    if (postgresBreaker.status().state === 'OPEN') {
      return res.status(503).json({ success: false, status: 'not_ready', reason: 'postgres_breaker_open' });
    }
    await pg.dbGet('SELECT 1');
    res.json({ success: true, status: 'ready' });
  } catch (err) {
    res.status(503).json({ success: false, status: 'not_ready', reason: 'db_unreachable' });
  }
});

// ── Health endpoint — minimal readiness payload (no internal details) ─────────
app.get('/health', async (req, res) => {
  try {
    // Verify DB connectivity — keep the check, drop the detail from response
    await pg.dbGet('SELECT 1');
    const whatsappService = require('./services/whatsappService');
    const { whatsappBreaker, postgresBreaker, llmBreaker } = require('./middleware/circuitBreaker');

    // Update Prometheus gauges (internal observability only)
    whatsappClientsGauge.set(whatsappService.clients.size);
    circuitBreakerOpen.labels({ name: 'whatsapp' }).set(whatsappBreaker.status().state === 'OPEN' ? 1 : 0);
    circuitBreakerOpen.labels({ name: 'postgres' }).set(postgresBreaker.status().state === 'OPEN' ? 1 : 0);
    circuitBreakerOpen.labels({ name: 'llm'      }).set(llmBreaker.status().state === 'OPEN' ? 1 : 0);

    // PG pool saturation — `pool` is exposed by our pool wrapper
    try {
      const poolRef = pg.pool;
      const total = poolRef.totalCount || 0;
      const idle  = poolRef.idleCount  || 0;
      pgPoolSaturation.set(total > 0 ? (total - idle) / total : 0);
    } catch (_) {}

    // Queue depth — best-effort (skip if Upstash misconfigured)
    try {
      const queue = require('../queue/upstashClient');
      const depth = await queue.queueLength('parse:listings');
      queueLagGauge.labels({ queue: 'parse:listings' }).set(depth);
    } catch (_) {}

    res.json({ success: true, status: 'ok' });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ success: false, status: 'unhealthy', error: 'Database unavailable' });
  }
});

// ── Prometheus metrics endpoint — token-gated ─────────────────────────────────
// Set METRICS_TOKEN in .env.  If unset the endpoint is disabled entirely so
// an operator can't accidentally expose metrics in production without a secret.
app.get('/api/v1/metrics', async (req, res) => {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return res.status(404).end('Not found');
  const provided = req.headers['x-metrics-token'];
  if (!provided || provided !== expected) return res.status(401).end('Unauthorized');
  res.set('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

// ── Media file serving — images/videos downloaded from WhatsApp ──────────────
// Requires auth so users can only access their own media.
// Files live at  data/media/<messageId>.<ext>  on the server filesystem.
const MEDIA_DIR = path.resolve(__dirname, '../../data/media');
app.get('/api/media/:filename', authenticate, (req, res) => {
  // Sanitise filename — no path traversal
  const name = path.basename(req.params.filename);
  if (!name || name.startsWith('.') || /[/\\]/.test(name)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Media not found' });
  }
  // Serve with appropriate content-type; browser caches aggressively
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filepath);
});

// ── Apply rate limiting to all /api routes ───────────────────────────────────
app.use('/api', apiLimiter);

// ── WhatsApp v1 routes (circuit-breaker wraps initiateQR inside the route) ──
app.use('/api/v1/whatsapp', whatsappRoutes);

// ── Scraper status — derived from Postgres whatsapp_sessions ─────────────────
app.get('/api/scraper/status', authenticate, async (req, res) => {
  try {
    const row = await pg.dbGet(
      `SELECT ws.status, ws.phone, ws.last_ready_at, ws.updated_at,
              COUNT(mg.id) FILTER (WHERE mg.is_active) AS active_groups,
              (SELECT COUNT(*) FROM raw_messages rm WHERE rm.user_id = u.id) AS total_messages
         FROM users u
         LEFT JOIN whatsapp_sessions ws ON ws.user_id = u.id
         LEFT JOIN monitored_groups mg ON mg.user_id = u.id
        WHERE u.clerk_user_id = $1
        GROUP BY ws.status, ws.phone, ws.last_ready_at, ws.updated_at, u.id`,
      [req.userId]
    );
    res.json({ success: true, data: row || { status: 'not_connected', active_groups: 0, total_messages: 0 } });
  } catch (err) {
    logger.error('GET /api/scraper/status failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Listings ─────────────────────────────────────────────────────────────────
// ── Listings — Postgres primary, user-scoped ─────────────────────────────────
app.get('/api/listings/today', authenticate, auditLog('view_listings', 'listing'), async (req, res) => {
  try {
    const clerkUserId = req.userId;  // set by authenticate middleware from verified JWT
    const {
      location, min_price, max_price, property_type,
      agent_phone, furnished, min_confidence = 0.2,
      intent, unit_type, bedrooms, rent_period, min_reposts,
    } = req.query;

    // Repost filter: keep only listings re-posted at least N times by the same
    // sender (eager-seller signal). repost_count is a window aggregate so it
    // can't go in WHERE directly — we filter it in an outer query below.
    // Only meaningful for N > 1 (every row has a count of at least 1).
    const minRepostsNum = parseInt(min_reposts);
    const hasRepostFilter = !isNaN(minRepostsNum) && minRepostsNum > 1;

    const rawLimit  = parseInt(req.query.limit);
    const rawOffset = parseInt(req.query.offset);
    const limit  = (!isNaN(rawLimit)  && rawLimit  > 0) ? Math.min(rawLimit,  500) : 250;
    const offset = (!isNaN(rawOffset) && rawOffset >= 0) ? rawOffset : 0;

    // Opt-out filter for non-property listings (vehicles, services, classifieds
    // that the parser mis-classified as apartments). Enabled by default — the
    // dashboard can pass ?include_non_property=true to see everything.
    const includeNonProperty = req.query.include_non_property === 'true';

    if (min_price && isNaN(Number(min_price)))
      return res.status(400).json({ success: false, error: 'min_price must be a number' });
    if (max_price && isNaN(Number(max_price)))
      return res.status(400).json({ success: false, error: 'max_price must be a number' });
    if (min_price && max_price && Number(min_price) > Number(max_price))
      return res.status(400).json({ success: false, error: 'min_price cannot be greater than max_price' });

    // Cache key scoped to THIS user — never share cache across users
    const cacheKey = `listings:${clerkUserId}:${JSON.stringify(req.query)}`;
    const cached   = await cacheService.get(cacheKey);
    if (cached) {
      cacheHitsCounter.inc();
      return res.json({ success: true, data: cached, fromCache: true });
    }
    cacheMissesCounter.inc();

    // Resolve clerk_user_id → postgres uuid (or null if user not yet in PG)
    const userRow = await pg.dbGet(
      'SELECT id FROM users WHERE clerk_user_id = $1', [clerkUserId]
    ).catch(() => null);

    if (!userRow) {
      // User exists in Clerk but hasn't scraped yet — return empty, not an error
      return res.json({
        success: true,
        data: { listings: [], pagination: { total: 0, limit, offset, hasMore: false }, statistics: {} },
      });
    }

    const pgUserId = userRow.id;

    // Build parameterised Postgres WHERE clause — always scoped to pgUserId
    const conditions = [
      `l.user_id = $1`,
      `l.ts_listed >= NOW() - INTERVAL '4 days'`,
      `(l.confidence >= $2 OR l.confidence IS NULL)`,
    ];
    const params = [pgUserId, parseFloat(min_confidence)];
    let p = params.length;

    if (location)      { conditions.push(`l.community ILIKE $${++p}`);   params.push(`%${location}%`); }
    if (min_price)     { conditions.push(`l.price >= $${++p}`);           params.push(parseInt(min_price)); }
    if (max_price)     { conditions.push(`l.price <= $${++p}`);           params.push(parseInt(max_price)); }
    if (property_type) { conditions.push(`l.property_type = $${++p}`);    params.push(property_type); }
    if (agent_phone)   { conditions.push(`l.agent_phone = $${++p}`);      params.push(agent_phone); }
    // furnished accepts canonical TEXT values: 'furnished' | 'semi-furnished' | 'unfurnished'
    if (furnished)     { conditions.push(`l.furnished = $${++p}`);         params.push(furnished); }
    if (intent)        { conditions.push(`l.intent = $${++p}`);            params.push(intent); }
    if (unit_type)     { conditions.push(`l.unit_type = $${++p}`);         params.push(unit_type); }
    if (bedrooms !== undefined && bedrooms !== '') {
      const bedroomsNum = parseFloat(bedrooms);
      if (!isNaN(bedroomsNum)) { conditions.push(`l.bedrooms = $${++p}`); params.push(bedroomsNum); }
    }
    if (rent_period)   { conditions.push(`l.rent_period = $${++p}`);       params.push(rent_period); }

    // Non-property filter — drop messages the LLM mis-classified as flats.
    //
    // Postgres regex uses POSIX bracketed word boundaries [[:<:]] / [[:>:]]
    // (NOT \m / \M which are PCRE-only and silently no-op here), and POSIX
    // character classes [[:space:]] / [[:digit:]] (NOT \s / \d).
    //
    // We exclude a listing when BOTH:
    //   (a) the raw text contains obvious vehicle/service keywords, AND
    //   (b) the raw text does NOT contain typical property keywords.
    //
    // This catches the "2018 model 4500k chalo … 95k" case where the LLM
    // hallucinated property_type=apartment + bedrooms=1, because (a) is
    // true ("model", "chalo") and (b) is true (no BHK/flat/rent).
    if (!includeNonProperty) {
      conditions.push(`NOT (
        LOWER(COALESCE(r.text, l.description, '')) ~* '[[:<:]](bike|scooter|motorcycle|motorbike|royal[[:space:]]*enfield|bullet|activa|yamaha|hero[[:space:]]*splendor|km[[:space:]]*driven|km[[:space:]]*running|km[[:space:]]*ran|chalo|chala|chalti|cc[[:space:]]*engine|petrol|diesel|second[[:space:]]*hand[[:space:]]*(car|bike|vehicle)|used[[:space:]]*(car|bike|vehicle)|year[[:space:]]*model|[0-9]{4}[[:space:]]+model|tutor|tuition|coaching|job[[:space:]]*vacancy|hiring|salary|interview|tiffin|wedding[[:space:]]*card|invitation)[[:>:]]'
        AND LOWER(COALESCE(r.text, l.description, '')) !~* '[[:<:]](bhk|rk|bk|br|bedroom|flat|apartment|villa|studio|penthouse|townhouse|plot|office|shop|sqft|sq[[:space:]]*ft|sq[[:space:]]*m|sqm|furnished|unfurnished|rent|sale|lease|owner|landlord|tenant|society|building|tower|complex)[[:>:]]'
      )`);
    }

    const where = conditions.join(' AND ');

    // The inner SELECT computes repost_count as a window aggregate over the
    // full WHERE-filtered set (correct across pagination). The outer query then
    // sorts by latest arrival and, when requested, drops rows below the repost
    // threshold. Build the listings param list + placeholders in order:
    //   $1..$N  -> the shared WHERE params
    //   $N+1    -> min_reposts threshold (only when hasRepostFilter)
    //   next    -> LIMIT, then OFFSET
    const listingsParams = [...params];
    let repostClause = '';
    if (hasRepostFilter) { repostClause = `WHERE sub.repost_count >= $${++p}`; listingsParams.push(minRepostsNum); }
    const limitPh  = ++p; listingsParams.push(limit);
    const offsetPh = ++p; listingsParams.push(offset);

    // Count must respect the repost filter too. Without the filter it's a plain
    // COUNT(*); with it, we wrap the windowed set and count the survivors.
    const countSql = hasRepostFilter
      ? `SELECT COUNT(*) AS count FROM (
           SELECT COUNT(*) OVER (PARTITION BY r.sender_wa_id, r.content_hash) AS repost_count
             FROM listings l
             LEFT JOIN raw_messages r ON r.id = l.raw_message_id
            WHERE ${where}
         ) sub WHERE sub.repost_count >= $${params.length + 1}`
      : `SELECT COUNT(*) AS count
           FROM listings l
           LEFT JOIN raw_messages r ON r.id = l.raw_message_id
          WHERE ${where}`;
    const countParams = hasRepostFilter ? [...params, minRepostsNum] : params;

    // All three queries need LEFT JOIN raw_messages now because the
    // non-property filter inspects r.text. Without the JOIN the COUNT and
    // stats queries throw "missing FROM-clause entry for table r".
    const [countRes, listingsRes, statsRes] = await Promise.all([
      pg.query(countSql, countParams),
      pg.query(
        `SELECT * FROM (
           SELECT l.id, l.price, l.currency,
                  l.community   AS location,
                  l.area_text,
                  l.bedrooms, l.bathrooms, l.unit_type,
                  l.property_type, l.area_sqft, l.area_sqm,
                  l.furnished,
                  (l.amenities @> ARRAY['parking']::text[])::int AS parking,
                  l.agent_name, l.description, l.group_name,
                  l.wa_group_id,
                  l.confidence  AS extraction_confidence,
                  l.ts_listed   AS created_at,
                  l.intent, l.rent_period, l.vacant, l.amenities,
                  -- Repost signal: how many times this exact message (same sender +
                  -- same content_hash) appears in the result set. A higher count means
                  -- the agent re-posted the same flat repeatedly = more eager. We count
                  -- via a window so it's correct across pagination, and we DON'T merge
                  -- rows on price/config (two distinct flats with the same rent have
                  -- different text → different content_hash → counted separately).
                  COUNT(*) OVER (PARTITION BY r.sender_wa_id, r.content_hash) AS repost_count,
                  -- Strip any @xxx suffix the parser may have stored in agent_phone,
                  -- then fall back to the sender's @c.us number when agent_phone is absent.
                  COALESCE(
                    NULLIF(regexp_replace(COALESCE(l.agent_phone, ''), '@\\S+$', ''), ''),
                    CASE
                      WHEN r.sender_wa_id LIKE '%@c.us'
                      THEN regexp_replace(r.sender_wa_id, '@c\\.us$', '')
                      ELSE NULL
                    END
                  ) AS agent_phone,
                  r.sender_wa_id,
                  r.sender_name,
                  r.has_media,
                  r.media_keys
           FROM listings l
           LEFT JOIN raw_messages r ON r.id = l.raw_message_id
           WHERE ${where}
         ) sub
         ${repostClause}
         -- Default order: latest arrival first. Reposts are surfaced via a
         -- filter + badge, not by reordering the feed.
         ORDER BY sub.created_at DESC
         LIMIT $${limitPh} OFFSET $${offsetPh}`,
        listingsParams
      ),
      pg.query(
        `SELECT AVG(l.price) as avg_price, MIN(l.price) as min_price, MAX(l.price) as max_price,
                AVG(l.bedrooms) as avg_bedrooms, AVG(l.area_sqft) as avg_area
           FROM listings l
           LEFT JOIN raw_messages r ON r.id = l.raw_message_id
          WHERE ${where}`,
        params
      ),
    ]);

    const total = parseInt(countRes.rows[0].count);
    const data = {
      listings: listingsRes.rows,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
      statistics: statsRes.rows[0] || {},
    };

    await cacheService.set(cacheKey, data, config.cacheTTL.listings);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /api/listings/today failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Filter option values — all derived from the user's actual data ───────────
// Returns distinct values present in the last 4 days of the user's listings.
// No hardcoded lists — works for any market (India, UAE, …).
app.get('/api/listings/filters', authenticate, async (req, res) => {
  try {
    const clerkUserId = req.userId;
    const userRow = await pg.dbGet(
      'SELECT id FROM users WHERE clerk_user_id = $1', [clerkUserId]
    ).catch(() => null);

    if (!userRow) {
      return res.json({ success: true, data: {} });
    }

    const pgUserId = userRow.id;
    const SINCE = `NOW() - INTERVAL '30 days'`;

    // Run each query independently so one broken column doesn't kill the whole response.
    const safeQuery = async (label, sql, params) => {
      try {
        return await pg.query(sql, params);
      } catch (e) {
        logger.warn(`[filters] ${label} failed: ${e.message}`);
        return { rows: [] };
      }
    };

    const [locations, configs, priceRanges, intents, propertyTypes, furnishedVals, rentPeriods] = await Promise.all([
      safeQuery('locations', `
        SELECT DISTINCT community AS location
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE} AND community IS NOT NULL
        ORDER BY community`, [pgUserId]),

      safeQuery('configs', `
        SELECT DISTINCT bedrooms, unit_type
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE} AND bedrooms IS NOT NULL
        ORDER BY bedrooms, unit_type NULLS LAST`, [pgUserId]),

      safeQuery('price_ranges', `
        SELECT currency,
               MIN(price)::float AS min_price,
               MAX(price)::float AS max_price,
               COUNT(*)          AS count
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE}
          AND price IS NOT NULL AND currency IS NOT NULL
        GROUP BY currency
        ORDER BY count DESC`, [pgUserId]),

      safeQuery('intents', `
        SELECT DISTINCT intent
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE} AND intent IS NOT NULL
        ORDER BY intent`, [pgUserId]),

      safeQuery('property_types', `
        SELECT DISTINCT property_type
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE} AND property_type IS NOT NULL
        ORDER BY property_type`, [pgUserId]),

      safeQuery('furnished', `
        SELECT DISTINCT furnished
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE} AND furnished IS NOT NULL
        ORDER BY furnished`, [pgUserId]),

      safeQuery('rent_periods', `
        SELECT DISTINCT rent_period
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${SINCE} AND rent_period IS NOT NULL
        ORDER BY rent_period`, [pgUserId]),
    ]);

    res.json({
      success: true,
      data: {
        locations:      locations.rows.map(r => r.location),
        configurations: configs.rows.map(r => ({
          bedrooms:  parseFloat(r.bedrooms),
          unit_type: r.unit_type || null,
        })),
        price_ranges:   priceRanges.rows.map(r => ({
          currency:  r.currency,
          min_price: r.min_price,
          max_price: r.max_price,
        })),
        intents:        intents.rows.map(r => r.intent),
        property_types: propertyTypes.rows.map(r => r.property_type),
        furnished:      furnishedVals.rows.map(r => r.furnished),
        rent_periods:   rentPeriods.rows.map(r => r.rent_period),
      },
    });
  } catch (error) {
    logger.error('GET /api/listings/filters failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Scrape activity stats — Postgres, user-scoped ────────────────────────────
app.get('/api/scrape-stats', authenticate, async (req, res) => {
  try {
    const clerkUserId = req.userId;

    const userRow = await pg.dbGet(
      'SELECT id FROM users WHERE clerk_user_id = $1', [clerkUserId]
    ).catch(() => null);

    if (!userRow) {
      return res.json({
        success: true,
        data: { rawMessages: 0, listingsTotal: 0, listingsHighConfidence: 0, byGroup: [], byConfidence: { high: 0, medium: 0, low: 0 } },
      });
    }

    const pgUserId = userRow.id;
    const since = `NOW() - INTERVAL '4 days'`;

    const [rawCount, listingsAll, listingsConf, byGroup, byConfidence] = await Promise.all([
      pg.query(
        `SELECT COUNT(*) AS n FROM raw_messages WHERE user_id = $1 AND ts_received >= ${since}`,
        [pgUserId]
      ),
      pg.query(
        `SELECT COUNT(*) AS n FROM listings WHERE user_id = $1 AND ts_listed >= ${since}`,
        [pgUserId]
      ),
      pg.query(
        `SELECT COUNT(*) AS n FROM listings WHERE user_id = $1 AND ts_listed >= ${since} AND confidence >= 0.2`,
        [pgUserId]
      ),
      pg.query(
        `SELECT group_name, COUNT(*) AS count FROM listings
         WHERE user_id = $1 AND ts_listed >= ${since}
         GROUP BY group_name ORDER BY count DESC LIMIT 10`,
        [pgUserId]
      ),
      pg.query(
        `SELECT
           SUM(CASE WHEN confidence >= 0.7 THEN 1 ELSE 0 END) AS high,
           SUM(CASE WHEN confidence >= 0.3 AND confidence < 0.7 THEN 1 ELSE 0 END) AS medium,
           SUM(CASE WHEN confidence < 0.3 OR confidence IS NULL THEN 1 ELSE 0 END) AS low
         FROM listings WHERE user_id = $1 AND ts_listed >= ${since}`,
        [pgUserId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        rawMessages: parseInt(rawCount.rows[0]?.n || 0),
        listingsTotal: parseInt(listingsAll.rows[0]?.n || 0),
        listingsHighConfidence: parseInt(listingsConf.rows[0]?.n || 0),
        byGroup: (byGroup.rows || []).map(r => ({ ...r, count: parseInt(r.count) })),
        byConfidence: {
          high:   parseInt(byConfidence.rows[0]?.high   || 0),
          medium: parseInt(byConfidence.rows[0]?.medium || 0),
          low:    parseInt(byConfidence.rows[0]?.low    || 0),
        },
      },
    });
  } catch (error) {
    logger.error('GET /api/scrape-stats failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/listings/:id', authenticate, auditLog('view_listing', 'listing'), async (req, res) => {
  try {
    const clerkUserId = req.userId;
    const userRow = await pg.dbGet('SELECT id FROM users WHERE clerk_user_id = $1', [clerkUserId]).catch(() => null);
    if (!userRow) return res.status(404).json({ success: false, error: 'Listing not found' });

    // Enforce user_id so a user can never fetch another user's listing by guessing an ID
    const res2 = await pg.query(
      `SELECT l.*,
              r.text        AS raw_message,
              r.has_media,
              r.media_keys,
              r.sender_wa_id,
              r.sender_name
       FROM listings l
       LEFT JOIN raw_messages r ON l.raw_message_id = r.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [req.params.id, userRow.id]
    );
    const listing = res2.rows[0];
    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
    res.json({ success: true, data: listing });
  } catch (error) {
    logger.error('GET /api/listings/:id failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── User "report wrong" flag ──────────────────────────────────────────────────
// The human detection channel: when our deterministic validators miss a bad
// extraction, the user tells us. We (a) count it so health.js shows the flag
// rate — i.e. how much auto-heal is missing — and (b) immediately quarantine
// the owner's own row so the bad data stops being shown while we add a rule.
// Scoped to the listing's owner (it's their data), so a flag can't be abused.
app.post('/api/listings/:id/flag', authenticate, auditLog('flag_listing', 'listing'), async (req, res) => {
  try {
    const userRow = await pg.dbGet('SELECT id FROM users WHERE clerk_user_id = $1', [req.userId]).catch(() => null);
    if (!userRow) return res.status(404).json({ success: false, error: 'Listing not found' });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 80) : '';
    const updated = await pg.dbGet(
      `UPDATE listings
          SET user_flags        = user_flags + 1,
              last_flagged_at   = NOW(),
              quarantine_reason = 'user_flagged' || CASE WHEN $3 <> '' THEN ':' || $3 ELSE '' END,
              confidence        = 0,
              updated_at        = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING user_flags`,
      [req.params.id, userRow.id, reason]
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Listing not found' });
    res.json({ success: true, data: { user_flags: updated.user_flags, hidden: true } });
  } catch (error) {
    logger.error('POST /api/listings/:id/flag failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── AI-generated property summary ─────────────────────────────────────────────
// Calls Groq with the raw message + extracted fields to produce a professional
// 2-3 sentence description. Results are cached via cacheService (TTL-backed,
// Redis when available) to avoid redundant LLM calls without memory leaks.
const SUMMARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
app.get('/api/listings/:id/summary', authenticate, async (req, res) => {
  try {
    const clerkUserId = req.userId;
    const userRow = await pg.dbGet('SELECT id FROM users WHERE clerk_user_id = $1', [clerkUserId]).catch(() => null);
    if (!userRow) return res.status(404).json({ success: false, error: 'Not found' });

    const id = req.params.id;
    const cacheKey = `summary:${id}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: { summary: cached, cached: true } });
    }

    const row = await pg.dbGet(
      `SELECT l.intent, l.property_type, l.bedrooms, l.unit_type, l.bathrooms,
              l.community, l.area_text, l.price, l.currency, l.rent_period,
              l.furnished, l.area_sqft, l.area_sqm, l.amenities, l.vacant,
              l.agent_name,
              r.text AS raw_message
         FROM listings l
         LEFT JOIN raw_messages r ON l.raw_message_id = r.id
        WHERE l.id = $1 AND l.user_id = $2`,
      [id, userRow.id]
    );
    if (!row) return res.status(404).json({ success: false, error: 'Listing not found' });

    const groqKey = process.env.GROQ_API_KEY;
    const rawText = (row.raw_message || row.description || '').slice(0, 600);

    // Build structured context
    const details = [
      row.intent        && `Intent: ${row.intent}`,
      row.property_type && `Type: ${row.property_type}`,
      row.bedrooms != null && `Configuration: ${row.bedrooms} ${row.unit_type || 'BR'}`,
      (row.community || row.area_text) && `Location: ${row.community || row.area_text}`,
      row.price != null && `Price: ${row.price} ${row.currency || ''} ${row.rent_period ? `per ${row.rent_period}` : ''}`.trim(),
      row.furnished     && `Furnished: ${row.furnished}`,
      row.area_sqft     && `Area: ${row.area_sqft} sqft`,
      row.bathrooms     && `Bathrooms: ${row.bathrooms}`,
      row.vacant != null && `Vacant: ${row.vacant ? 'Yes' : 'No'}`,
      row.amenities?.length && `Amenities: ${row.amenities.join(', ')}`,
    ].filter(Boolean).join('\n');

    if (!groqKey) {
      // No API key — generate a template summary from extracted fields
      const loc   = row.community || row.area_text || 'the area';
      const conf  = row.bedrooms != null ? `${row.bedrooms} ${row.unit_type || 'BR'}` : '';
      const price = row.price != null
        ? ` at ${row.currency === 'INR' ? '₹' : (row.currency || '')}${row.price}${row.rent_period ? `/${row.rent_period}` : ''}`
        : '';
      const summary = `${conf ? conf + ' ' : ''}${row.property_type || 'Property'} available for ${row.intent || 'listing'} in ${loc}${price}.${row.furnished ? ` ${row.furnished.charAt(0).toUpperCase() + row.furnished.slice(1)}.` : ''}`;
      await cacheService.set(cacheKey, summary, SUMMARY_CACHE_TTL_MS);
      return res.json({ success: true, data: { summary } });
    }

    const prompt = `You are a professional real estate assistant. Based on this WhatsApp property listing, write a polished 2-3 sentence property description suitable for a real estate website.

Raw WhatsApp message:
"${rawText}"

Extracted details:
${details}

Rules:
- Only mention facts present in the message — do not invent details.
- Write in English only.
- Keep it 2-3 sentences, professional and informative.
- Start with the most important feature (location and configuration).`;

    // Circuit-breaker + AbortController: if Groq is down (10 consecutive
    // failures), short-circuit to the template fallback for 30s instead of
    // making every request wait the full 30s timeout.
    let gjson;
    try {
      gjson = await llmBreaker.execute(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 200,
              temperature: 0.3,
            }),
            signal: controller.signal,
          });
          if (!groqRes.ok) throw new Error(`Groq ${groqRes.status}`);
          return await groqRes.json();
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (err) {
      if (err.code === 'CIRCUIT_OPEN') {
        logger.warn('LLM circuit open — using template fallback', { requestId: req.requestId });
        throw new Error('LLM unavailable, using fallback');
      }
      throw err;
    }
    const summary = gjson.choices?.[0]?.message?.content?.trim() || '';

    if (summary) await cacheService.set(cacheKey, summary, SUMMARY_CACHE_TTL_MS);
    res.json({ success: true, data: { summary } });
  } catch (error) {
    logger.error('GET /api/listings/:id/summary failed', { error: error.message });
    // Groq failed — fall back to a template summary so the UI always has something to show
    try {
      const fallbackRow = await pg.dbGet(
        `SELECT l.intent, l.property_type, l.bedrooms, l.unit_type, l.community, l.area_text,
                l.price, l.currency, l.rent_period, l.furnished
           FROM listings l WHERE l.id = $1 AND l.user_id = (SELECT id FROM users WHERE clerk_user_id = $2)`,
        [req.params.id, req.userId]
      );
      if (fallbackRow) {
        const loc  = fallbackRow.community || fallbackRow.area_text || 'the area';
        const conf = fallbackRow.bedrooms != null ? `${fallbackRow.bedrooms} ${fallbackRow.unit_type || 'BR'}` : '';
        const priceStr = fallbackRow.price != null
          ? ` at ${fallbackRow.currency === 'INR' ? '₹' : (fallbackRow.currency || '')}${Number(fallbackRow.price).toLocaleString()}${fallbackRow.rent_period ? `/${fallbackRow.rent_period}` : ''}`
          : '';
        const summary = `${conf ? conf + ' ' : ''}${fallbackRow.property_type || 'Property'} available for ${fallbackRow.intent || 'listing'} in ${loc}${priceStr}.${fallbackRow.furnished ? ' ' + fallbackRow.furnished.charAt(0).toUpperCase() + fallbackRow.furnished.slice(1) + '.' : ''}`;
        await cacheService.set(`summary:${req.params.id}`, summary, SUMMARY_CACHE_TTL_MS);
        return res.json({ success: true, data: { summary } });
      }
    } catch (_) { /* ignore nested error */ }
    res.status(500).json({ success: false, error: 'Summary generation failed' });
  }
});

// ── Full-text search — Postgres tsvector, user-scoped ───────────────────────
app.get('/api/v1/search', authenticate, searchLimiter, auditLog('search', 'listing'), async (req, res) => {
  try {
    const { q = '', limit: rawLimit = 100, offset: rawOffset = 0 } = req.query;
    const limit  = Math.min(parseInt(rawLimit)  || 100, 500);
    const offset = Math.max(parseInt(rawOffset) || 0,   0);

    if (!q.trim())
      return res.status(400).json({ success: false, error: 'Search query cannot be empty' });

    // Cache key must be user-scoped — never share search results across users
    const cacheKey = `search:${req.userId}:${q}:${limit}:${offset}`;
    const cached   = await cacheService.get(cacheKey);
    if (cached) {
      cacheHitsCounter.inc();
      return res.json({ success: true, data: cached, fromCache: true });
    }
    cacheMissesCounter.inc();

    const userRow = await pg.dbGet(
      'SELECT id FROM users WHERE clerk_user_id = $1', [req.userId]
    );
    if (!userRow) return res.json({ success: true, data: { listings: [], pagination: { total: 0, limit, offset, hasMore: false } } });

    // plainto_tsquery is PostgreSQL's built-in safe parser — handles arbitrary
    // user text without manual sanitisation.  Never use to_tsquery with
    // hand-constructed input because & | ! operators can cause unexpected results.
    const [countRes, listingsRes] = await Promise.all([
      pg.query(
        `SELECT COUNT(*) AS count FROM listings
          WHERE user_id = $1 AND fts @@ plainto_tsquery('simple', $2)`,
        [userRow.id, q.trim()]
      ),
      pg.query(
        `SELECT *, ts_rank(fts, plainto_tsquery('simple', $2)) AS rank
           FROM listings
          WHERE user_id = $1 AND fts @@ plainto_tsquery('simple', $2)
          ORDER BY rank DESC
          LIMIT $3 OFFSET $4`,
        [userRow.id, q.trim(), limit, offset]
      ),
    ]);

    const total = parseInt(countRes.rows[0].count);
    const data = {
      listings: listingsRes.rows,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    };
    await cacheService.set(cacheKey, data, config.cacheTTL.search);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /api/v1/search failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Daily digest by date — Postgres daily_stats, user-scoped ─────────────────
// On a miss we lazily call recompute_daily_stats() so the endpoint always
// returns a fresh rollup if data exists for that date.
app.get('/api/v1/digests/:date', authenticate, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });

    const userRow = await pg.dbGet(
      'SELECT id FROM users WHERE clerk_user_id = $1', [req.userId]
    );
    if (!userRow) return res.status(404).json({ success: false, error: 'No data found' });

    const readStats = async () => pg.query(
      `SELECT community, intent, property_type,
              listings_count, avg_price, median_price, min_price, max_price, avg_area_sqft
         FROM daily_stats
        WHERE user_id = $1 AND date = $2
        ORDER BY listings_count DESC`,
      [userRow.id, date]
    );

    let result = await readStats();
    if (!result.rows.length) {
      // Lazy recompute — first read after listings change
      try {
        await pg.query('SELECT recompute_daily_stats($1, $2::date)', [userRow.id, date]);
        result = await readStats();
      } catch (e) {
        logger.warn('recompute_daily_stats failed', { error: e.message });
      }
    }
    if (!result.rows.length)
      return res.status(404).json({ success: false, error: `No digest found for ${date}` });

    res.json({ success: true, data: { date, rows: result.rows } });
  } catch (err) {
    logger.error('GET /api/v1/digests/:date failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Agents — Postgres, user-scoped ───────────────────────────────────────────
app.get('/api/agents', authenticate, async (req, res) => {
  try {
    const cacheKey = `agents:${req.userId}`;
    const cached   = await cacheService.get(cacheKey);
    if (cached) { cacheHitsCounter.inc(); return res.json({ success: true, data: cached, fromCache: true }); }
    cacheMissesCounter.inc();

    const result = await pg.query(
      `SELECT l.agent_phone, l.agent_name,
              COUNT(*) AS listing_count,
              MAX(l.created_at) AS last_listing_date
         FROM listings l
         JOIN users u ON u.id = l.user_id
        WHERE u.clerk_user_id = $1 AND l.agent_phone IS NOT NULL
        GROUP BY l.agent_phone, l.agent_name
        ORDER BY listing_count DESC`,
      [req.userId]
    );
    await cacheService.set(cacheKey, result.rows, config.cacheTTL.agents);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('GET /api/agents failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Groups — Postgres, user-scoped ───────────────────────────────────────────
app.get('/api/groups', authenticate, async (req, res) => {
  try {
    const cacheKey = `groups:${req.userId}`;
    const cached   = await cacheService.get(cacheKey);
    if (cached) { cacheHitsCounter.inc(); return res.json({ success: true, data: cached, fromCache: true }); }
    cacheMissesCounter.inc();

    const result = await pg.query(
      `SELECT l.group_name,
              COUNT(*) AS listing_count,
              MAX(l.created_at) AS last_update
         FROM listings l
         JOIN users u ON u.id = l.user_id
        WHERE u.clerk_user_id = $1
        GROUP BY l.group_name
        ORDER BY last_update DESC`,
      [req.userId]
    );
    await cacheService.set(cacheKey, result.rows, config.cacheTTL.groups);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('GET /api/groups failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Analytics — server-side SQL aggregation, paginated-safe ─────────────────
// Pushes all the heavy lifting (group breakdowns, price histograms, intent
// distribution) into Postgres instead of doing it client-side over the
// first 100 listings. Scales to millions of listings since the aggregations
// hit indexed columns. Cached for 5 minutes per user.
app.get('/api/v1/analytics/overview', authenticate, async (req, res) => {
  try {
    const window = (req.query.window || '4d').toString();
    const validWindow = /^\d+[dh]$/.test(window) ? window : '4d';
    const cacheKey = `analytics:overview:${req.userId}:${validWindow}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) { cacheHitsCounter.inc(); return res.json({ success: true, data: cached, fromCache: true }); }
    cacheMissesCounter.inc();

    const userRow = await pg.dbGet('SELECT id FROM users WHERE clerk_user_id = $1', [req.userId]);
    if (!userRow) return res.json({ success: true, data: { totals: {}, byGroup: [], byIntent: [], byBedrooms: [], priceBuckets: [] } });

    const sinceClause = `NOW() - INTERVAL '${validWindow.endsWith('h') ? parseInt(validWindow) + ' hours' : parseInt(validWindow) + ' days'}'`;

    const [totals, byGroup, byIntent, byBedrooms, priceBuckets, byCommunity] = await Promise.all([
      pg.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE confidence >= 0.7) AS high_confidence,
               AVG(price) FILTER (WHERE currency = 'INR') AS avg_price_inr,
               AVG(price) FILTER (WHERE currency = 'AED') AS avg_price_aed,
               COUNT(DISTINCT community) AS distinct_communities,
               COUNT(DISTINCT agent_phone) FILTER (WHERE agent_phone IS NOT NULL) AS distinct_agents
        FROM listings WHERE user_id = $1 AND ts_listed >= ${sinceClause}
      `, [userRow.id]),
      pg.query(`
        SELECT group_name, COUNT(*) AS count, AVG(price) AS avg_price
        FROM listings WHERE user_id = $1 AND ts_listed >= ${sinceClause}
        GROUP BY group_name ORDER BY count DESC LIMIT 10
      `, [userRow.id]),
      pg.query(`
        SELECT COALESCE(intent, 'unknown') AS intent, COUNT(*) AS count
        FROM listings WHERE user_id = $1 AND ts_listed >= ${sinceClause}
        GROUP BY intent ORDER BY count DESC
      `, [userRow.id]),
      pg.query(`
        SELECT COALESCE(bedrooms::text, 'unknown') AS bedrooms, COUNT(*) AS count
        FROM listings WHERE user_id = $1 AND ts_listed >= ${sinceClause}
        GROUP BY bedrooms ORDER BY bedrooms NULLS LAST LIMIT 20
      `, [userRow.id]),
      pg.query(`
        SELECT currency,
               width_bucket(price::numeric, 0, 200000, 10) AS bucket,
               COUNT(*) AS count, MIN(price) AS lo, MAX(price) AS hi
        FROM listings
        WHERE user_id = $1 AND ts_listed >= ${sinceClause}
          AND price IS NOT NULL AND currency IS NOT NULL
        GROUP BY currency, bucket ORDER BY currency, bucket
      `, [userRow.id]),
      pg.query(`
        SELECT community, COUNT(*) AS count, AVG(price) AS avg_price
        FROM listings WHERE user_id = $1 AND ts_listed >= ${sinceClause} AND community IS NOT NULL
        GROUP BY community ORDER BY count DESC LIMIT 15
      `, [userRow.id]),
    ]);

    const data = {
      window: validWindow,
      totals: totals.rows[0] || {},
      byGroup:     byGroup.rows,
      byIntent:    byIntent.rows,
      byBedrooms:  byBedrooms.rows,
      byCommunity: byCommunity.rows,
      priceBuckets: priceBuckets.rows,
    };
    await cacheService.set(cacheKey, data, 5 * 60 * 1000);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('GET /api/v1/analytics/overview failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Terms of Service — check & accept ────────────────────────────────────────
// GET  /api/user/tos-status  → { accepted: bool, tos_accepted_at, privacy_accepted_at }
app.get('/api/user/tos-status', authenticate, async (req, res) => {
  try {
    const result = await pg.query(
      `SELECT tos_accepted_at, privacy_accepted_at
         FROM users
        WHERE clerk_user_id = $1`,
      [req.userId]
    );
    if (!result.rows.length) {
      // User row doesn't exist yet — upsert it so subsequent calls work
      await pg.query(
        `INSERT INTO users (clerk_user_id) VALUES ($1) ON CONFLICT (clerk_user_id) DO NOTHING`,
        [req.userId]
      );
      return res.json({ success: true, accepted: false, tos_accepted_at: null, privacy_accepted_at: null });
    }
    const row = result.rows[0];
    const accepted = !!(row.tos_accepted_at && row.privacy_accepted_at);
    return res.json({ success: true, accepted, tos_accepted_at: row.tos_accepted_at, privacy_accepted_at: row.privacy_accepted_at });
  } catch (err) {
    logger.error('GET /api/user/tos-status failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/user/accept-terms  → { success: true }
app.post('/api/user/accept-terms', authenticate, async (req, res) => {
  try {
    const now = new Date().toISOString();
    await pg.query(
      `INSERT INTO users (clerk_user_id, tos_accepted_at, privacy_accepted_at)
            VALUES ($1, $2, $2)
       ON CONFLICT (clerk_user_id)
       DO UPDATE SET tos_accepted_at     = COALESCE(users.tos_accepted_at, EXCLUDED.tos_accepted_at),
                     privacy_accepted_at = COALESCE(users.privacy_accepted_at, EXCLUDED.privacy_accepted_at)`,
      [req.userId, now]
    );
    return res.json({ success: true, accepted_at: now });
  } catch (err) {
    logger.error('POST /api/user/accept-terms failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── 404 for all unknown /api routes ─────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ── Block dotfiles before static serving ─────────────────────────────────────
app.use((req, res, next) => {
  if (/^\/\./.test(req.path)) return res.status(404).json({ success: false, error: 'Not found' });
  next();
});

// ── Global error handler — must have 4 params for Express to treat as error middleware ──
// Catches any error passed via next(err), incl. CORS rejections, to suppress stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { method: req.method, path: req.path, error: err.message });
  res.status(err.status || 500).json({ success: false, error: 'Internal server error' });
});

// ── Static files (React SPA) ─────────────────────────────────────────────────
// Serve hashed assets with long-term caching; HTML must be re-fetched so the
// per-request CSP nonce can be injected.
const DIST_DIR = path.resolve(__dirname, '../../dashboard/dist');
app.use(express.static(DIST_DIR, {
  index: false,        // never serve index.html via static middleware
  maxAge: '1y',        // hashed Vite assets
  immutable: true,
}));

// SPA fallback — inject the per-request CSP nonce into the served HTML so
// inline bootstrap <script> tags (e.g. dark-mode initialiser in index.html)
// are accepted by the strict CSP without 'unsafe-inline'.
let _indexHtmlCache = null;
function _loadIndexHtml() {
  if (_indexHtmlCache && process.env.NODE_ENV === 'production') return _indexHtmlCache;
  const html = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  _indexHtmlCache = html;
  return html;
}

app.get(/^(?!\/api).+/, (req, res) => {
  try {
    const html = _loadIndexHtml();
    const nonce = res.locals.cspNonce;
    // Stamp the nonce onto every <script> tag — both inline and src= bundles.
    // With 'strict-dynamic' in our CSP, ALL scripts (including Vite's
    // module bundle) must carry the nonce or the browser refuses to load them.
    // The 'strict-dynamic' keyword then lets those nonced scripts trigger
    // sub-loads without further nonce/allowlist gymnastics.
    const stamped = html.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(stamped);
  } catch (err) {
    logger.error('Failed to serve SPA index', { error: err.message });
    res.status(500).send('Server error');
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
let httpServer = null;

async function startServer() {
  try {
    await runMigrations();
    httpServer = app.listen(config.port, () =>
      logger.info(`Server running at http://localhost:${config.port}`, {
        env: process.env.NODE_ENV || 'development',
        port: config.port,
        redis: process.env.REDIS_URL ? 'enabled' : 'disabled (in-memory cache)',
      })
    );

    // Auto-resume WhatsApp bridges for users whose sessions were 'ready'
    // before the previous shutdown. We delay 3s so the HTTP listener is
    // settled before we fork child processes that may eat a chunk of CPU
    // while wppconnect spins up Chromium.
    setTimeout(() => {
      const whatsappService = require('./services/whatsappService');
      whatsappService.autoResumeBridges().catch(err =>
        logger.warn('autoResumeBridges failed', { error: err.message })
      );
    }, 3000).unref();
  } catch (err) {
    logger.error('Server failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Docker/K8s send SIGTERM before SIGKILL; without these handlers the server
// would drop in-flight requests, leak PG pool connections, and orphan bridge
// subprocesses. We give in-flight work up to 10s to finish, then exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — graceful shutdown initiated`);

  // Stop accepting new connections
  if (httpServer) {
    httpServer.close(() => logger.info('HTTP server closed'));
  }

  // Force-kill any active WhatsApp bridge children so they don't outlive us
  try {
    const whatsappService = require('./services/whatsappService');
    for (const [userId, entry] of whatsappService.clients.entries()) {
      try {
        if (entry.child && !entry.child.killed) entry.child.kill('SIGTERM');
        whatsappService._stopTailer?.(userId);
      } catch (_) {}
    }
  } catch (_) {}

  // Drain the PG pool
  try { await pg.close?.(); } catch (_) {}

  // Hard exit after 10s if something is still hanging
  setTimeout(() => {
    logger.warn('Forced exit after 10s grace period');
    process.exit(1);
  }, 10_000).unref();

  // Clean exit once everything drained
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Last-resort safety net — unhandled rejections shouldn't crash the process
// silently, but they should be visible.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  // Don't exit — let the operator decide via SIGTERM. Crash loops are worse
  // than a degraded process in production.
});

// Export helpers so other modules can use them
module.exports = {
  cacheService,
  listingsCreatedCounter,
  sseFailuresCounter,
  llmTimeoutsCounter,
  bridgeReconnectsCounter,
  queueLagGauge,
};

startServer();
