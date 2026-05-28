-- FTS5 virtual table for fast full-text search across listings.
-- Uses a standalone table (not external-content) to avoid rowid complexity
-- with UUID primary keys. Triggers keep it in sync with the listings table.

CREATE VIRTUAL TABLE IF NOT EXISTS listings_fts USING fts5(
  listing_id UNINDEXED,   -- UUID stored but not indexed
  location,
  description,
  property_type,
  agent_name
);

-- ── Sync triggers ─────────────────────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS listings_fts_ai
AFTER INSERT ON listings BEGIN
  INSERT INTO listings_fts(listing_id, location, description, property_type, agent_name)
  VALUES (
    new.id,
    COALESCE(new.location, ''),
    COALESCE(new.description, ''),
    COALESCE(new.property_type, ''),
    COALESCE(new.agent_name, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS listings_fts_ad
AFTER DELETE ON listings BEGIN
  DELETE FROM listings_fts WHERE listing_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS listings_fts_au
AFTER UPDATE ON listings BEGIN
  DELETE FROM listings_fts WHERE listing_id = old.id;
  INSERT INTO listings_fts(listing_id, location, description, property_type, agent_name)
  VALUES (
    new.id,
    COALESCE(new.location, ''),
    COALESCE(new.description, ''),
    COALESCE(new.property_type, ''),
    COALESCE(new.agent_name, '')
  );
END;

-- ── Backfill any rows that pre-date this migration ─────────────────────────
INSERT OR IGNORE INTO listings_fts(listing_id, location, description, property_type, agent_name)
SELECT
  id,
  COALESCE(location, ''),
  COALESCE(description, ''),
  COALESCE(property_type, ''),
  COALESCE(agent_name, '')
FROM listings
WHERE id NOT IN (SELECT listing_id FROM listings_fts);
