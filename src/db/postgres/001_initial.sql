-- ============================================================================
-- PropDigest — Postgres schema v1
-- Designed for Dubai market, multi-user, scale to 1k+ users
-- Uses pgvector for semantic search, GIN/tsvector for FTS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- fuzzy text matching
CREATE EXTENSION IF NOT EXISTS "vector";         -- semantic search & dedup

-- ─── Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id   TEXT UNIQUE NOT NULL,
  email           TEXT,
  market          TEXT NOT NULL DEFAULT 'dubai',  -- 'dubai' | 'india' | 'uk' | ...
  plan            TEXT NOT NULL DEFAULT 'free',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_clerk ON users(clerk_user_id);

-- ─── WhatsApp session per user ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending|qr_ready|ready|disconnected
  phone          TEXT,
  bridge_pid     INT,
  bridge_host    TEXT,                              -- which worker node owns the bridge
  last_ready_at  TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ─── Groups being monitored ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitored_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_group_id     TEXT NOT NULL,                   -- '...@g.us'
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
  language        TEXT,                            -- detected via franc-min ('en','ar','hi',...)
  has_media       BOOLEAN NOT NULL DEFAULT FALSE,
  media_keys      TEXT[],                          -- R2/S3 keys
  content_hash    TEXT,                            -- sha256 of normalized text for cross-group dedup
  ts_received     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, wa_message_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_user_ts ON raw_messages(user_id, ts_received DESC);
CREATE INDEX IF NOT EXISTS idx_raw_group ON raw_messages(wa_group_id, ts_received DESC);
CREATE INDEX IF NOT EXISTS idx_raw_hash ON raw_messages(content_hash) WHERE content_hash IS NOT NULL;

-- ─── Parsed listings (LLM output) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_message_id        UUID NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
  wa_group_id           TEXT NOT NULL,
  group_name            TEXT,

  -- What kind of post
  intent                TEXT,                      -- 'rent'|'sale'|'wanted'|'roommate'|'unknown'
  property_type         TEXT,                      -- 'apartment'|'villa'|'townhouse'|'studio'|'penthouse'|'plot'|'office'|'shop'

  -- Configuration
  bedrooms              NUMERIC(3,1),              -- supports 0 (studio), 0.5, 1, 2, …
  bathrooms             NUMERIC(3,1),
  area_sqft             INT,
  area_sqm              INT,
  furnished             TEXT,                      -- 'furnished'|'unfurnished'|'semi-furnished'
  vacant                BOOLEAN,
  amenities             TEXT[],                    -- ['gym','pool','parking','maid-room',...]

  -- Pricing
  price                 NUMERIC(14,2),
  currency              TEXT DEFAULT 'AED',
  rent_period           TEXT,                      -- 'yearly'|'monthly'|'weekly'|null
  price_per_sqft        NUMERIC(10,2),

  -- Location
  area_text             TEXT,                      -- raw text from message
  community             TEXT,                      -- normalized: 'Dubai Marina','JBR','Downtown',...
  emirate               TEXT DEFAULT 'Dubai',
  lat                   NUMERIC(10,6),
  lng                   NUMERIC(10,6),
  geocoded_at           TIMESTAMPTZ,

  -- Agent
  agent_name            TEXT,
  agent_phone           TEXT,
  agent_whatsapp        TEXT,

  -- Quality / provenance
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0,
  extracted_by          TEXT NOT NULL DEFAULT 'regex',   -- 'regex'|'llm-groq'|'llm-ollama'|'manual'
  raw_llm_json          JSONB,
  embedding             vector(384),                     -- semantic dedup + search
  description           TEXT,                            -- short summary for cards

  ts_listed             TIMESTAMPTZ NOT NULL,            -- when the message was posted
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- FTS over the indexable text
  fts                   tsvector GENERATED ALWAYS AS (
                          setweight(to_tsvector('simple', coalesce(community,'')), 'A') ||
                          setweight(to_tsvector('simple', coalesce(area_text,'')), 'B') ||
                          setweight(to_tsvector('simple', coalesce(description,'')), 'C')
                        ) STORED
);
CREATE INDEX IF NOT EXISTS idx_listings_user_ts ON listings(user_id, ts_listed DESC);
CREATE INDEX IF NOT EXISTS idx_listings_intent ON listings(user_id, intent, ts_listed DESC);
CREATE INDEX IF NOT EXISTS idx_listings_community ON listings(community);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_bedrooms ON listings(bedrooms);
CREATE INDEX IF NOT EXISTS idx_listings_fts ON listings USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_listings_confidence ON listings(user_id, confidence DESC) WHERE confidence >= 0.5;
-- Vector index for similarity search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_listings_embedding ON listings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Parse job queue mirror (Redis is the working queue; this is for audit) ─
CREATE TABLE IF NOT EXISTS parse_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_message_id  UUID NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed|dead
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  worker_id       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_status ON parse_jobs(status, created_at);

-- ─── Runtime config (replaces all hardcoded constants) ────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  key             TEXT PRIMARY KEY,
  value           JSONB NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'global',   -- 'global'|'user'
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  description     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(key, user_id)
);

-- ─── Saved searches / alerts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_searches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  filters         JSONB NOT NULL,                   -- {community, min_price, max_price, bedrooms,…}
  notify_via      TEXT NOT NULL DEFAULT 'none',     -- 'none'|'web-push'|'email'
  last_match_at   TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_searches(user_id);

-- ─── Daily aggregates (pre-computed for fast charts) ──────────────────────
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
  avg_area_sqft   INT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date, community, intent, property_type)
);
CREATE INDEX IF NOT EXISTS idx_daily_user_date ON daily_stats(user_id, date DESC);

-- ─── Audit log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  resource    TEXT,
  metadata    JSONB,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
