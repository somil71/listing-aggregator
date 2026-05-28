-- Migration 002 — add unit_type column and normalise furnished to consistent TEXT values
-- unit_type captures the Indian/Gulf room classification (BHK vs RK vs BR vs Studio)
-- furnished was stored as mixed integer/text; normalise to canonical strings

-- Add unit_type if not already present
ALTER TABLE listings ADD COLUMN IF NOT EXISTS unit_type TEXT;

-- Normalise any furnished values that were stored as '0','1','2' (old integer-as-text storage)
UPDATE listings
   SET furnished = CASE
         WHEN furnished = '1' THEN 'furnished'
         WHEN furnished = '0' THEN 'unfurnished'
         WHEN furnished = '2' THEN 'semi-furnished'
         ELSE furnished          -- keep values already in canonical form
       END
 WHERE furnished IN ('0', '1', '2');

-- Index for filtering/sorting by unit type
CREATE INDEX IF NOT EXISTS idx_listings_unit_type ON listings(user_id, unit_type, ts_listed DESC)
  WHERE unit_type IS NOT NULL;
