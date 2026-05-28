const logger = require('../../config/logger');

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
  /**
   * @param {string} name         Human-readable name for logging
   * @param {number} threshold    Consecutive failures before opening (default 5)
   * @param {number} timeout      How long (ms) to stay OPEN before probing (default 60s)
   */
  constructor(name, threshold = 5, timeout = 60_000) {
    this.name = name;
    this.threshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = STATES.CLOSED;
  }

  async execute(fn) {
    // Fast-fail in HALF_OPEN unless we're the probe.  This prevents the
    // thundering-herd race where 10 concurrent callers all execute fn()
    // during the probe window.
    if (this.state === STATES.HALF_OPEN && this._probing) {
      throw Object.assign(
        new Error(`Service temporarily unavailable (circuit open: ${this.name})`),
        { code: 'CIRCUIT_OPEN' }
      );
    }

    if (this.state === STATES.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        if (this._probing) {
          throw Object.assign(
            new Error(`Service temporarily unavailable (circuit open: ${this.name})`),
            { code: 'CIRCUIT_OPEN' }
          );
        }
        this._probing = true;
        this.state = STATES.HALF_OPEN;
        logger.info(`CircuitBreaker [${this.name}] → HALF_OPEN (probing)`);
      } else {
        throw Object.assign(
          new Error(`Service temporarily unavailable (circuit open: ${this.name})`),
          { code: 'CIRCUIT_OPEN' }
        );
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (err.code === 'CIRCUIT_OPEN') throw err;
      this._onFailure();
      throw err;
    } finally {
      this._probing = false;
    }
  }

  _onSuccess() {
    this.failureCount = 0;
    if (this.state === STATES.HALF_OPEN) {
      this.state = STATES.CLOSED;
      logger.info(`CircuitBreaker [${this.name}] → CLOSED (recovered)`);
    }
  }

  _onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold && this.state !== STATES.OPEN) {
      this.state = STATES.OPEN;
      logger.warn(`CircuitBreaker [${this.name}] → OPEN after ${this.failureCount} failures`);
    }
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
    };
  }
}

// Singletons — one breaker per external dependency.
// Threshold tuned per backend:
//   - WhatsApp bridge: 5 failures, 60s cool-off (slow to recover)
//   - Postgres:        3 failures, 10s cool-off (fast recovery, lower threshold)
//   - LLM (Groq/Gem):  10 failures, 30s cool-off (rate-limit blips common)
module.exports = {
  CircuitBreaker,
  whatsappBreaker: new CircuitBreaker('whatsapp', 5, 60_000),
  postgresBreaker: new CircuitBreaker('postgres', 3, 10_000),
  llmBreaker:      new CircuitBreaker('llm', 10, 30_000),
};
