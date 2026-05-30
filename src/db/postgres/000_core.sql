-- Core schema bootstrap — all essential tables, no pgvector dependency.
-- Runs before 001_initial.sql (alphabetical order). If 001 fails due to
-- the vector extension not being available, the app still works fully.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id       TEXT UNIQUE NOT NULL,
  email               TEXT,
  market              TEXT NOT NULL DEFAULT 'dubai',
  plan                TEXT NOT NULL DEFAULT 'free',
  tos_accepted_at     TIMESTAMPTZ,
  privacy_accepted_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_clerk ON users(clerk_user_id);

-- ─── WhatsApp session per user ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending',
  phone          TEXT,
  bridge_pid     INT,
  bridge_host    TEXT,
  last_ready_at  TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ─── Groups being monitored ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitored_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_group_id     TEXT NOT NULL,
  group_name      TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  message_count   INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, wa_group_id)
);
CREATE INDEX IF NOT EXISTS idx_monitored_user ON monitored_groups(user_id) WHERE is_active;

-- ─── Raw scraped messages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_group_id     TEXT NOT NULL,
  wa_message_id   TEXT NOT NULL,
  sender_wa_id    TEXT,
  sender_name     TEXT,
  text            TEXT,
  language        TEXT,
  has_media       BOOLEAN NOT NULL DEFAULT FALSE,
  media_keys      TEXT[],
  content_hash    TEXT,
  ts_received     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, wa_message_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_user_ts   ON raw_messages(user_id, ts_received DESC);
CREATE INDEX IF NOT EXISTS idx_raw_group     ON raw_messages(wa_group_id, ts_received DESC);
CREATE INDEX IF NOT EXISTS idx_raw_hash      ON raw_messages(content_hash) WHERE content_hash IS NOT NULL;

-- ─── Parsed listings — no embedding column, no pgvector required ─────────
CREATE TABLE IF NOT EXISTS listings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_message_id    UUID NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
  wa_group_id       TEXT NOT NULL,
  group_name        TEXT,
  intent            TEXT,
  property_type     TEXT,
  bedrooms          NUMERIC(3,1),
  bathrooms         NUMERIC(3,1),
  unit_type         TEXT,
  area_sqft         INT,
  area_sqm          INT,
  furnished         TEXT,
  vacant            BOOLEAN,
  amenities         TEXT[],
  price             NUMERIC(14,2),
  currency          TEXT DEFAULT 'AED',
  rent_period       TEXT,
  price_per_sqft    NUMERIC(10,2),
  area_text         TEXT,
  community         TEXT,
  emirate           TEXT DEFAULT 'Dubai',
  lat               NUMERIC(10,6),
  lng               NUMERIC(10,6),
  geocoded_at       TIMESTAMPTZ,
  agent_name        TEXT,
  agent_phone       TEXT,
  agent_whatsapp    TEXT,
  confidence        NUMERIC(4,3) NOT NULL DEFAULT 0,
  extracted_by      TEXT NOT NULL DEFAULT 'regex',
  raw_llm_json      JSONB,
  description       TEXT,
  ts_listed         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quarantine_reason TEXT,
  user_flags        INT NOT NULL DEFAULT 0,
  last_flagged_at   TIMESTAMPTZ,
  fts               tsvector GENERATED ALWAYS AS (
                      setweight(to_tsvector('simple', coalesce(community,'')),    'A') ||
                      setweight(to_tsvector('simple', coalesce(area_text,'')),    'B') ||
                      setweight(to_tsvector('simple', coalesce(description,'')), 'C')
                    ) STORED,
  UNIQUE(raw_message_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_user_ts    ON listings(user_id, ts_listed DESC);
CREATE INDEX IF NOT EXISTS idx_listings_intent     ON listings(user_id, intent, ts_listed DESC);
CREATE INDEX IF NOT EXISTS idx_listings_community  ON listings(community);
CREATE INDEX IF NOT EXISTS idx_listings_price      ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_bedrooms   ON listings(bedrooms);
CREATE INDEX IF NOT EXISTS idx_listings_fts        ON listings USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_listings_confidence ON listings(user_id, confidence DESC) WHERE confidence >= 0.5;
CREATE INDEX IF NOT EXISTS idx_listings_quarantined ON listings(quarantine_reason) WHERE quarantine_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_flagged    ON listings(user_flags DESC) WHERE user_flags > 0;
CREATE INDEX IF NOT EXISTS idx_listings_unit_type  ON listings(user_id, unit_type, ts_listed DESC) WHERE unit_type IS NOT NULL;

-- ─── Parse job queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parse_jobs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_message_id   UUID NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  worker_id        TEXT,
  updated_at       TIMESTAMPTZ,
  first_attempt_at TIMESTAMPTZ,
  dead_at          TIMESTAMPTZ,
  dead_reason      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  UNIQUE(raw_message_id)
);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_status        ON parse_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_dead          ON parse_jobs(dead_at DESC) WHERE status = 'dead';
CREATE INDEX IF NOT EXISTS idx_parse_jobs_failed_attempts ON parse_jobs(attempts DESC) WHERE status = 'failed';

-- ─── Daily aggregates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_stats (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  community       TEXT,
  intent          TEXT,
  property_type   TEXT,
  listings_count  INT NOT NULL DEFAULT 0,
  avg_price       NUMERIC(14,2),
  median_price    NUMERIC(14,2),
  min_price       NUMERIC(14,2),
  max_price       NUMERIC(14,2),
  avg_area_sqft   NUMERIC(10,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date, community, intent, property_type)
);
CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date ON daily_stats(user_id, date DESC);

CREATE OR REPLACE FUNCTION recompute_daily_stats(p_user_id UUID, p_date DATE)
RETURNS INT AS $$
DECLARE v_inserted INT;
BEGIN
  DELETE FROM daily_stats WHERE user_id = p_user_id AND date = p_date;
  WITH src AS (
    SELECT community, intent, property_type,
           COUNT(*)                                            AS listings_count,
           AVG(price)                                         AS avg_price,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
           MIN(price)                                         AS min_price,
           MAX(price)                                         AS max_price,
           AVG(area_sqft)                                     AS avg_area_sqft
      FROM listings
     WHERE user_id = p_user_id AND ts_listed::date = p_date
     GROUP BY community, intent, property_type
  )
  INSERT INTO daily_stats (user_id, date, community, intent, property_type,
    listings_count, avg_price, median_price, min_price, max_price, avg_area_sqft)
  SELECT p_user_id, p_date, community, intent, property_type,
    listings_count, avg_price, median_price, min_price, max_price, avg_area_sqft
  FROM src;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$ LANGUAGE plpgsql;

-- ─── Audit log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  resource   TEXT,
  metadata   JSONB,
  ip         INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);

-- ─── Quality snapshots ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quality_snapshots (
  date              DATE PRIMARY KEY,
  total             INT NOT NULL,
  quarantined       INT NOT NULL DEFAULT 0,
  user_flagged_rows INT NOT NULL DEFAULT 0,
  flag_total        INT NOT NULL DEFAULT 0,
  flag_rate         NUMERIC(6,4),
  quarantine_rate   NUMERIC(6,4),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
