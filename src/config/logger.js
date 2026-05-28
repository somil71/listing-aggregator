require('dotenv').config();
const winston = require('winston');
const path = require('path');
const fs = require('fs');

let otelApi = null;
try { otelApi = require('@opentelemetry/api'); } catch { /* tracing not enabled */ }

const LOG_DIR = path.resolve(__dirname, '../../../logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

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

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
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
  transports: [
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
    }),
  ],
});

// Human-readable console output in non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const extra = Object.keys(meta).length > 0 && meta.service !== 'property-digest'
          ? ' ' + JSON.stringify(meta)
          : '';
        return `${timestamp} [${level}] ${message}${extra}`;
      })
    ),
  }));
}

module.exports = logger;
