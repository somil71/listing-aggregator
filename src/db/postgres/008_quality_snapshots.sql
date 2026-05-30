-- Daily quality snapshot — one row per day, written by health.js on each global
-- run (UPSERT by date). Lets us see whether the user-flag rate and quarantine
-- rate are trending up over time, instead of only knowing today's number. A
-- rising flag rate = our auto-heal is missing more, i.e. time to add a rule.
CREATE TABLE IF NOT EXISTS quality_snapshots (
  date              DATE PRIMARY KEY,
  total             INT NOT NULL,
  quarantined       INT NOT NULL DEFAULT 0,
  user_flagged_rows INT NOT NULL DEFAULT 0,
  flag_total        INT NOT NULL DEFAULT 0,
  flag_rate         NUMERIC(6,4),         -- user_flagged_rows / total
  quarantine_rate   NUMERIC(6,4),         -- quarantined / total
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
