-- ============================================================================
-- PropDigest — Additional schema tables (complementing 000_core.sql)
-- These are additional tables not included in the core bootstrap.
-- ============================================================================

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
