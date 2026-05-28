-- daily_stats — denormalised per-user/per-day aggregations for the digest endpoint.
-- The /api/v1/digests/:date endpoint reads from this table; it is refreshed
-- nightly by a cron job (or on-demand via the recompute_daily_stats function).
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

CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date
  ON daily_stats(user_id, date DESC);

-- Recompute the rollup for a given user/date.  Safe to call repeatedly:
-- it deletes the existing day's rows for that user then re-inserts.
CREATE OR REPLACE FUNCTION recompute_daily_stats(p_user_id UUID, p_date DATE)
RETURNS INT AS $$
DECLARE
  v_inserted INT;
BEGIN
  DELETE FROM daily_stats
   WHERE user_id = p_user_id AND date = p_date;

  WITH src AS (
    SELECT community, intent, property_type,
           COUNT(*)                                   AS listings_count,
           AVG(price)                                 AS avg_price,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
           MIN(price)                                 AS min_price,
           MAX(price)                                 AS max_price,
           AVG(area_sqft)                             AS avg_area_sqft
      FROM listings
     WHERE user_id = p_user_id
       AND ts_listed::date = p_date
     GROUP BY community, intent, property_type
  )
  INSERT INTO daily_stats
    (user_id, date, community, intent, property_type,
     listings_count, avg_price, median_price, min_price, max_price, avg_area_sqft)
  SELECT p_user_id, p_date, community, intent, property_type,
         listings_count, avg_price, median_price, min_price, max_price, avg_area_sqft
    FROM src;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$ LANGUAGE plpgsql;
