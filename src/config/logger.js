require('dotenv').config();
const winston = require('winston');
const path = require('path');
const fs = require('fs');

let otelApi = null;
try { otelApi = require('@opentelemetry/api'); } catch { /* tracing not enabled */ }

// Resolve to <project-root>/logs.  __dirname is .../src/config, so ../../logs
// lands at the project root (in the container that's /app/logs, which the
// Dockerfile creates and chowns to the app user). Overridable via LOG_DIR.
//
// File logging is BEST-EFFORT: a read-only or non-writable container root (some
// PaaS platforms, distroless images) must never crash the process on require.
// If the dir can't be created we log to stdout only — which Railway, Docker and
// k8s capture anyway.
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');
let fileLoggingEnabled = false;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fileLoggingEnabled = true;
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[logger] file logging disabled (${LOG_DIR}: ${err.code || err.message}) — using stdout only`);
}

// Inject the active OTel trace_id / span_id into every log record so logs
// and traces can be correlated in a single pane (Loki + Tempo, ELK, etc.)
const traceContextFormat = winston.format((info) => {
  if (otelApi) {
    const span = otelApi.trace.getActiveSpan();
    if (span) {
      const ctx = span.spanContext();
      info.trace_id = ctx.traceId;
      info.span_id  = ctx.spanId;
    }
  }
  return info;
});

const isProd = process.env.NODE_ENV === 'production';

// stdout is ALWAYS a transport (so PaaS/container log streams see output). File
// transports are added only when the log dir is writable.
const transports = [];
if (fileLoggingEnabled) {
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'app.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 20,
      tailable: true,
    })
  );
}
transports.push(new winston.transports.Console(
  isProd
    // Production: inherit the structured JSON format below — ideal for the
    // Railway log pane and downstream aggregators.
    ? {}
    // Dev: human-readable, colorized.
    : {
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const extra = Object.keys(meta).length > 0 && meta.service !== 'property-digest'
              ? ' ' + JSON.stringify(meta)
              : '';
            return `${timestamp} [${level}] ${message}${extra}`;
          })
        ),
      }
));

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'warn' : 'info'),
  format: winston.format.combine(
    traceContextFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'property-digest',
    env: process.env.NODE_ENV || 'development',
  },
  transports,
});

module.exports = logger;
