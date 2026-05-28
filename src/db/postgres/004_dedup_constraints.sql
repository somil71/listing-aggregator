-- Prevent duplicate listings and parse jobs for the same source message.
-- ON CONFLICT guards in parseWorker.js rely on these unique constraints.

-- Deduplicate listings: keep the row with the highest confidence / most recent id
DELETE FROM listings a
USING listings b
WHERE a.raw_message_id = b.raw_message_id
  AND a.id < b.id;

ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_raw_message_id_key;
ALTER TABLE listings
  ADD CONSTRAINT listings_raw_message_id_key UNIQUE (raw_message_id);

-- Deduplicate parse_jobs: keep the most recent row per raw_message_id
DELETE FROM parse_jobs a
USING parse_jobs b
WHERE a.raw_message_id = b.raw_message_id
  AND a.id < b.id;

ALTER TABLE parse_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE parse_jobs
  DROP CONSTRAINT IF EXISTS parse_jobs_raw_message_id_key;
ALTER TABLE parse_jobs
  ADD CONSTRAINT parse_jobs_raw_message_id_key UNIQUE (raw_message_id);
