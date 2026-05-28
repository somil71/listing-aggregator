-- Dead-letter capability + retry tracking for parse_jobs.
-- A job that fails N times stays out of the active queue and lands here for
-- post-mortem inspection.

ALTER TABLE parse_jobs
  ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_reason      TEXT;

-- Status values: 'pending' | 'processing' | 'done' | 'failed' | 'dead'
-- The worker promotes 'failed' → 'dead' after MAX_ATTEMPTS.

CREATE INDEX IF NOT EXISTS idx_parse_jobs_dead
  ON parse_jobs(dead_at DESC)
  WHERE status = 'dead';

CREATE INDEX IF NOT EXISTS idx_parse_jobs_failed_attempts
  ON parse_jobs(attempts DESC)
  WHERE status = 'failed';
