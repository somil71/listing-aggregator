// OpenTelemetry bootstrap — full distributed-tracing instrumentation.
//
// Auto-instruments Express, http, pg, ioredis, fetch, dns. Spans are
// exported via OTLP/HTTP to whatever collector OTEL_EXPORTER_OTLP_ENDPOINT
// points at (Tempo, Jaeger, Honeycomb, Grafana Cloud, …).
//
// Disabled when OTEL_DISABLED=true or OTEL_EXPORTER_OTLP_ENDPOINT is unset
// so local dev doesn't waste cycles serialising spans to nowhere.
//
// MUST be required FIRST in the entry file (server.js / parseWorker.js)
// — auto-instrumentation hooks into module loading.

const ENABLED =
  process.env.OTEL_DISABLED !== 'true' &&
  !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (!ENABLED) {
  module.exports = { sdk: null, enabled: false };
} else {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:    process.env.OTEL_SERVICE_NAME    || 'property-digest',
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || require('../../package.json').version,
      'deployment.environment': process.env.NODE_ENV || 'development',
      'service.instance.id':    process.env.HOSTNAME || `pid-${process.pid}`,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`,
      }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [getNodeAutoInstrumentations({
      // Disable fs instrumentation — too noisy from logging/state-file writes
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
    })],
  });

  try {
    sdk.start();
    console.log('[otel] tracing enabled →', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  } catch (err) {
    console.error('[otel] failed to start:', err.message);
  }

  // Graceful shutdown — flush spans before exit
  const flush = async () => {
    try { await sdk.shutdown(); } catch (_) {}
  };
  process.on('SIGTERM', flush);
  process.on('SIGINT',  flush);
  process.on('beforeExit', flush);

  module.exports = { sdk, enabled: true };
}
