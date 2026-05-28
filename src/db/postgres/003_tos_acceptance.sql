-- ============================================================================
-- Migration 003: add Terms of Service + Privacy Policy acceptance timestamps
-- These are set once on first login and never changed.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tos_accepted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN users.tos_accepted_at
  IS 'Timestamp when this user first accepted the Terms of Service. NULL = not accepted yet.';
COMMENT ON COLUMN users.privacy_accepted_at
  IS 'Timestamp when this user first accepted the Privacy Policy. NULL = not accepted yet.';
