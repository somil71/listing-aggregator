-- Raw messages (audit trail of all extracted messages)
CREATE TABLE IF NOT EXISTS raw_messages (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  sender_name TEXT,
  message_text TEXT,
  timestamp DATETIME,
  has_images INTEGER DEFAULT 0,
  image_count INTEGER DEFAULT 0,
  image_paths TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Parsed listings (structured, searchable)
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  raw_message_id TEXT UNIQUE REFERENCES raw_messages(id),

  -- Extracted fields
  price INTEGER,
  location TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  area_sqft INTEGER,
  property_type TEXT,
  furnished INTEGER,
  parking INTEGER,

  -- Agent details
  agent_name TEXT,
  agent_phone TEXT,
  sender_name TEXT,

  -- Metadata
  group_name TEXT NOT NULL,
  description TEXT,
  extraction_confidence REAL DEFAULT 0.5,
  image_paths TEXT,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily digest snapshots
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  digest_date DATE NOT NULL UNIQUE,
  listing_count INTEGER DEFAULT 0,
  new_listings INTEGER DEFAULT 0,
  total_price_range TEXT,
  summary_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User notes on listings
CREATE TABLE IF NOT EXISTS listing_notes (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  note_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(location);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_agent_phone ON listings(agent_phone);
CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type);
CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_confidence ON listings(extraction_confidence);

CREATE INDEX IF NOT EXISTS idx_digests_date ON digests(digest_date DESC);
CREATE INDEX IF NOT EXISTS idx_notes_listing ON listing_notes(listing_id);
