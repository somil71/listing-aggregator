/**
 * cacheService — Redis-first cache with transparent in-memory fallback.
 *
 * When REDIS_URL is set the service connects to Redis (ioredis).
 * If Redis is unreachable it automatically falls back to a local Map-based
 * TTL cache so the server continues to operate without interruption.
 *
 * All public methods are async so callers always await them.
 * The interface is identical regardless of the backend.
 */
const logger = require('../../config/logger');

let Redis;
try { Redis = require('ioredis'); } catch { Redis = null; }

class CacheService {
  constructor() {
    this._store      = new Map();   // in-memory fallback store
    this._redis      = null;
    this._redisReady = false;
    this._hits       = 0;
    this._misses     = 0;

    if (Redis && process.env.REDIS_URL) {
      this._initRedis(process.env.REDIS_URL);
    }

    // Periodic sweep of expired in-memory entries (runs even when Redis active
    // to prevent unbounded growth if Redis ever disconnects mid-run)
    setInterval(() => this._evict(), 5 * 60 * 1000).unref();
  }

  // ── Redis init ─────────────────────────────────────────────────────────────
  _initRedis(url) {
    // password is parsed from the URL (redis://:pass@host) by ioredis, but
    // pass it explicitly as a fallback so a misformatted URL doesn't silently
    // produce an unauthenticated connection.
    this._redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });

    this._redis.on('ready', () => {
      this._redisReady = true;
      logger.info('Cache: Redis connected', { url });
    });

    this._redis.on('error', (err) => {
      if (this._redisReady) {
        logger.warn('Cache: Redis error — falling back to in-memory', { error: err.message });
      }
      this._redisReady = false;
    });

    this._redis.on('reconnecting', () => {
      logger.debug('Cache: Redis reconnecting...');
    });

    this._redis.connect().catch(() => {
      logger.warn('Cache: Could not connect to Redis — using in-memory cache');
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async set(key, value, ttlMs) {
    if (this._redisReady) {
      await this._redis.set(key, JSON.stringify(value), 'PX', ttlMs);
      return;
    }
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async get(key) {
    if (this._redisReady) {
      const raw = await this._redis.get(key);
      if (raw === null) { this._misses++; return null; }
      this._hits++;
      try { return JSON.parse(raw); } catch { return null; }
    }

    const entry = this._store.get(key);
    if (!entry) { this._misses++; return null; }
    if (Date.now() > entry.expiresAt) { this._store.delete(key); this._misses++; return null; }
    this._hits++;
    return entry.value;
  }

  async invalidate(pattern) {
    if (this._redisReady) {
      // Use SCAN to avoid blocking Redis with KEYS on large datasets
      let cursor = '0';
      let deleted = 0;
      do {
        const [next, keys] = await this._redis.scan(cursor, 'MATCH', `*${pattern}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          await this._redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
      if (deleted > 0) logger.debug(`Cache: invalidated ${deleted} Redis key(s) matching "${pattern}"`);
      return deleted;
    }

    let count = 0;
    for (const key of this._store.keys()) {
      if (key.includes(pattern)) { this._store.delete(key); count++; }
    }
    if (count > 0) logger.debug(`Cache: invalidated ${count} in-memory key(s) matching "${pattern}"`);
    return count;
  }

  async invalidateListings() {
    await Promise.all([
      this.invalidate('listings:'),
      this.invalidate('search:'),
      this.invalidate('agents:'),
      this.invalidate('groups:'),
    ]);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _evict() {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this._store.entries()) {
      if (now > entry.expiresAt) { this._store.delete(key); evicted++; }
    }
    if (evicted > 0) logger.debug(`Cache: evicted ${evicted} expired in-memory entries`);
  }

  stats() {
    return {
      backend:  this._redisReady ? 'redis' : 'memory',
      size:     this._redisReady ? null : this._store.size,
      hits:     this._hits,
      misses:   this._misses,
      hitRate:  this._hits + this._misses > 0
        ? ((this._hits / (this._hits + this._misses)) * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}

module.exports = new CacheService();
