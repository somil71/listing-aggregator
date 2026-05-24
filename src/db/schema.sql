-- Raw messages (audit trail)
CREATE TABLE IF NOT EXISTS raw_messages (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  sender_name TEXT,
  message_text TEXT,
  timestamp DATETIME,
  has_images INTEGER,
  image_paths TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Parsed listings (searchable)
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  raw_message_id TEXT REFERENCES raw_messages(id),
  price INTEGER,
  location TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  area_sqft INTEGER,
  property_type TEXT,
  agent_name TEXT,
  agent_phone TEXT,
  furnished INTEGER,
  description TEXT,
  image_urls TEXT, -- JSON array
  group_name TEXT,
  extraction_confidence REAL, -- 0-1
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(raw_message_id)
);

-- Daily digests (snapshots)
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  digest_date DATE,
  listing_count INTEGER,
  new_listings INTEGER, -- compared to yesterday
  summary_json TEXT, -- { by_location, by_price_range, by_agent }
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(location);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_agent ON listings(agent_name);
CREATE INDEX IF NOT EXISTS idx_listings_date ON listings(created_at);
