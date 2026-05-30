-- Quality / auto-heal signals on listings.
--
-- quarantine_reason: set by the deterministic sanity validator (MessageParser
--   ._sanityCheck) when an extraction is confident-but-impossible — e.g. an LLM
--   that read "4500k chalo" (a vehicle ad) as a 4,500,000 INR rent. The worker
--   forces confidence to 0 on such rows, so the dashboard's min_confidence gate
--   auto-hides them. NULL = passed all sanity checks. This is how a hallucination
--   self-heals: re-running the (now-improved) validator over raw_messages
--   re-derives the row and quarantines it, with no human edit.
--
-- user_flags: how many times an end user has hit "report wrong" on the listing.
--   This is the second detection channel — when our validators miss something,
--   users tell us, and we can see the rate instead of waiting for a support
--   ticket. health.js surfaces both columns.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
  ADD COLUMN IF NOT EXISTS user_flags        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_flagged_at   TIMESTAMPTZ;

-- Fast "what's currently quarantined" lookups for the health snapshot.
CREATE INDEX IF NOT EXISTS idx_listings_quarantined
  ON listings(quarantine_reason)
  WHERE quarantine_reason IS NOT NULL;

-- Fast "what are users complaining about" lookups.
CREATE INDEX IF NOT EXISTS idx_listings_flagged
  ON listings(user_flags DESC)
  WHERE user_flags > 0;
