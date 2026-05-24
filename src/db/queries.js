// Pre-built, parameterised SQL queries — prevents SQL injection, centralises all SQL in one place

const queries = {
  listings: {
    getToday: `
      SELECT id, price, location, bedrooms, bathrooms, area_sqft,
             property_type, furnished, parking, agent_name, agent_phone,
             group_name, description, extraction_confidence, image_paths, created_at
      FROM listings
      WHERE DATE(created_at) = DATE('now', 'localtime')
        AND (extraction_confidence >= ? OR extraction_confidence IS NULL)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,

    countToday: `
      SELECT COUNT(*) as count FROM listings
      WHERE DATE(created_at) = DATE('now', 'localtime')
        AND (extraction_confidence >= ? OR extraction_confidence IS NULL)`,

    statsToday: `
      SELECT COUNT(*) as count, AVG(price) as avg_price,
             MIN(price) as min_price, MAX(price) as max_price,
             AVG(bedrooms) as avg_bedrooms, AVG(area_sqft) as avg_area
      FROM listings
      WHERE DATE(created_at) = DATE('now', 'localtime')`,

    getById: `
      SELECT l.*, r.message_text as raw_message
      FROM listings l
      LEFT JOIN raw_messages r ON l.raw_message_id = r.id
      WHERE l.id = ?`,

    insert: `
      INSERT INTO listings (
        id, raw_message_id, price, location, bedrooms, bathrooms,
        area_sqft, property_type, furnished, parking, agent_name,
        agent_phone, group_name, description, extraction_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    delete: `DELETE FROM listings WHERE id = ?`
  },

  agents: {
    getAll: `
      SELECT agent_phone, agent_name,
             COUNT(*) as listing_count,
             AVG(price) as avg_price,
             COUNT(DISTINCT group_name) as group_count,
             MAX(created_at) as last_listing_date
      FROM listings
      WHERE agent_phone IS NOT NULL
      GROUP BY agent_phone
      ORDER BY listing_count DESC
      LIMIT ? OFFSET ?`,

    countAll: `
      SELECT COUNT(DISTINCT agent_phone) as count
      FROM listings WHERE agent_phone IS NOT NULL`,

    getListings: `
      SELECT * FROM listings
      WHERE agent_phone = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`
  },

  groups: {
    getAll: `
      SELECT group_name,
             COUNT(*) as listing_count,
             MAX(created_at) as last_update,
             COUNT(DISTINCT agent_phone) as unique_agents,
             ROUND(AVG(extraction_confidence), 2) as avg_confidence
      FROM listings
      GROUP BY group_name
      ORDER BY last_update DESC
      LIMIT ? OFFSET ?`,

    countAll: `SELECT COUNT(DISTINCT group_name) as count FROM listings`,

    getListings: `
      SELECT * FROM listings
      WHERE group_name = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`
  },

  search: {
    run: `
      SELECT id, price, location, bedrooms, bathrooms, area_sqft,
             property_type, agent_name, agent_phone, group_name,
             description, extraction_confidence, created_at
      FROM listings
      WHERE location LIKE ?
         OR description LIKE ?
         OR agent_name LIKE ?
         OR group_name LIKE ?
      ORDER BY extraction_confidence DESC, created_at DESC
      LIMIT ? OFFSET ?`,

    count: `
      SELECT COUNT(*) as count FROM listings
      WHERE location LIKE ?
         OR description LIKE ?
         OR agent_name LIKE ?
         OR group_name LIKE ?`
  },

  digests: {
    getForDate: `
      SELECT * FROM listings
      WHERE DATE(created_at) = ?
      ORDER BY created_at DESC`,

    topLocations: `
      SELECT location, COUNT(*) as count, AVG(price) as avg_price
      FROM listings
      WHERE DATE(created_at) = ? AND location IS NOT NULL
      GROUP BY location
      ORDER BY count DESC
      LIMIT 5`,

    topAgents: `
      SELECT agent_phone, agent_name, COUNT(*) as count, AVG(price) as avg_price
      FROM listings
      WHERE DATE(created_at) = ? AND agent_phone IS NOT NULL
      GROUP BY agent_phone
      ORDER BY count DESC
      LIMIT 5`,

    previousCount: `
      SELECT COUNT(*) as count FROM listings
      WHERE DATE(created_at) = ?`,

    insert: `
      INSERT OR REPLACE INTO digests (id, digest_date, listing_count, summary_json)
      VALUES (?, ?, ?, ?)`
  },

  notes: {
    insert: `INSERT INTO listing_notes (id, listing_id, note_text) VALUES (?, ?, ?)`,
    getForListing: `SELECT * FROM listing_notes WHERE listing_id = ? ORDER BY created_at DESC`,
    delete: `DELETE FROM listing_notes WHERE id = ?`
  },

  health: {
    ping: `SELECT 1 as ok`,
    listingCount: `SELECT COUNT(*) as count FROM listings`
  }
};

module.exports = queries;
