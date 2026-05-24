const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { dbAll, dbGet, dbRun } = require('./db-helpers');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// GET /api/listings/today
app.get('/api/listings/today', async (req, res) => {
  try {
    const {
      location,
      min_price,
      max_price,
      property_type,
      agent_phone,
      furnished,
      min_confidence = 0.5,
      limit = 100,
      offset = 0
    } = req.query;

    let where = `DATE(created_at) = DATE('now')`;
    let params = [];

    if (location) {
      where += ` AND location = ?`;
      params.push(location);
    }
    if (min_price) {
      where += ` AND price >= ?`;
      params.push(parseInt(min_price));
    }
    if (max_price) {
      where += ` AND price <= ?`;
      params.push(parseInt(max_price));
    }
    if (property_type) {
      where += ` AND property_type = ?`;
      params.push(property_type);
    }
    if (agent_phone) {
      where += ` AND agent_phone = ?`;
      params.push(agent_phone);
    }
    if (furnished === 'true') {
      where += ` AND furnished = 1`;
    } else if (furnished === 'false') {
      where += ` AND furnished = 0`;
    }

    where += ` AND (extraction_confidence >= ? OR extraction_confidence IS NULL)`;
    params.push(parseFloat(min_confidence));

    const countRows = await dbAll(`SELECT COUNT(*) as count FROM listings WHERE ${where}`, params);
    const total = countRows[0].count;

    const sql = `
      SELECT * FROM listings
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const finalParams = [...params, parseInt(limit), parseInt(offset)];
    const listings = await dbAll(sql, finalParams);

    // Calculate statistics
    const stats = await dbAll(`
      SELECT
        AVG(price) as avg_price,
        MIN(price) as min_price,
        MAX(price) as max_price,
        AVG(bedrooms) as avg_bedrooms,
        AVG(area_sqft) as avg_area
      FROM listings
      WHERE ${where}
    `, params);

    res.json({
      success: true,
      data: {
        listings,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + parseInt(limit) < total
        },
        statistics: stats[0] || {}
      }
    });
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/listings/:id
app.get('/api/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await dbGet(`
      SELECT l.*, r.message_text as raw_message
      FROM listings l
      LEFT JOIN raw_messages r ON l.raw_message_id = r.id
      WHERE l.id = ?
    `, [id]);

    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
    res.json({ success: true, data: listing });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/agents
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await dbAll(`
      SELECT
        agent_phone,
        agent_name,
        COUNT(*) as listing_count,
        MAX(created_at) as last_listing_date
      FROM listings
      WHERE agent_phone IS NOT NULL
      GROUP BY agent_phone
      ORDER BY listing_count DESC
    `);
    res.json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/groups
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await dbAll(`
      SELECT
        group_name,
        COUNT(*) as listing_count,
        MAX(created_at) as last_update
      FROM listings
      GROUP BY group_name
      ORDER BY last_update DESC
    `);
    res.json({ success: true, data: groups });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/search
app.get('/api/search', async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    if (!q) return res.status(400).json({ success: false, error: 'Query required' });
    const searchTerm = `%${q}%`;
    const results = await dbAll(`
      SELECT * FROM listings
      WHERE location LIKE ? OR description LIKE ? OR group_name LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [searchTerm, searchTerm, searchTerm, parseInt(limit)]);
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/digests/:date
app.get('/api/digests/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Invalid date format' });

    const listings = await dbAll(`SELECT * FROM listings WHERE DATE(created_at) = ?`, [date]);
    const topLocations = await dbAll(`SELECT location, COUNT(*) as count FROM listings WHERE DATE(created_at) = ? GROUP BY location ORDER BY count DESC LIMIT 5`, [date]);
    const topAgents = await dbAll(`SELECT agent_phone, agent_name, COUNT(*) as count FROM listings WHERE DATE(created_at) = ? AND agent_phone IS NOT NULL GROUP BY agent_phone ORDER BY count DESC LIMIT 5`, [date]);

    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);
    const prevDateStr = previousDate.toISOString().split('T')[0];
    const prevCountRows = await dbAll(`SELECT COUNT(*) as count FROM listings WHERE DATE(created_at) = ?`, [prevDateStr]);

    res.json({
      success: true,
      data: {
        date,
        listings: listings.slice(0, 100),
        statistics: {
          total_listings: listings.length,
          new_from_previous: listings.length - (prevCountRows[0]?.count || 0),
          avg_price: listings.reduce((sum, l) => sum + (l.price || 0), 0) / listings.length || 0
        },
        top_locations: topLocations,
        top_agents: topAgents
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/listings/:id/note
app.post('/api/listings/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { note_text } = req.body;
    const noteId = uuidv4();
    await dbRun(`INSERT INTO listing_notes (id, listing_id, note_text) VALUES (?, ?, ?)`, [noteId, id, note_text]);
    res.json({ success: true, data: { id: noteId, listing_id: id, note_text } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use(express.static(path.resolve(__dirname, '../../dashboard/dist')));
app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.resolve(__dirname, '../../dashboard/dist/index.html')));

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
