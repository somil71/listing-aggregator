const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { dbAll, dbGet, dbRun } = require('./db-helpers');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret-property-key';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- AUTH MIDDLEWARE ---
const authenticate = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        await dbRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)", [uuidv4(), email, hash]);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'User already exists' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
    if (user && await bcrypt.compare(password, user.password_hash)) {
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        return res.json({ success: true, user: { email: user.email } });
    }
    res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({ success: true, user: req.user });
});

// --- SCRAPER STATUS ---
app.get('/api/scraper/status', authenticate, async (req, res) => {
    const status = await dbGet("SELECT * FROM scraper_status WHERE id = 1");
    res.json({ success: true, data: status });
});

// --- PROTECTED LISTING ROUTES ---
app.get('/api/listings/today', authenticate, async (req, res) => {
  try {
    const { location, min_price, max_price, property_type, agent_phone, furnished, min_confidence = 0.5, limit = 100, offset = 0 } = req.query;
    let where = `DATE(created_at) = DATE('now')`;
    let params = [];

    if (location) { where += ` AND location = ?`; params.push(location); }
    if (min_price) { where += ` AND price >= ?`; params.push(parseInt(min_price)); }
    if (max_price) { where += ` AND price <= ?`; params.push(parseInt(max_price)); }
    if (property_type) { where += ` AND property_type = ?`; params.push(property_type); }
    if (agent_phone) { where += ` AND agent_phone = ?`; params.push(agent_phone); }
    if (furnished === 'true') { where += ` AND furnished = 1`; } else if (furnished === 'false') { where += ` AND furnished = 0`; }
    where += ` AND (extraction_confidence >= ? OR extraction_confidence IS NULL)`;
    params.push(parseFloat(min_confidence));

    const countRows = await dbAll(`SELECT COUNT(*) as count FROM listings WHERE ${where}`, params);
    const total = countRows[0].count;
    const listings = await dbAll(`SELECT * FROM listings WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), parseInt(offset)]);
    const stats = await dbAll(`SELECT AVG(price) as avg_price, MIN(price) as min_price, MAX(price) as max_price, AVG(bedrooms) as avg_bedrooms, AVG(area_sqft) as avg_area FROM listings WHERE ${where}`, params);

    res.json({ success: true, data: { listings, pagination: { total, limit: parseInt(limit), offset: parseInt(offset), hasMore: parseInt(offset) + parseInt(limit) < total }, statistics: stats[0] || {} } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/listings/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const listing = await dbGet("SELECT l.*, r.message_text as raw_message FROM listings l LEFT JOIN raw_messages r ON l.raw_message_id = r.id WHERE l.id = ?", [id]);
    res.json({ success: true, data: listing });
});

app.get('/api/agents', authenticate, async (req, res) => {
    const agents = await dbAll("SELECT agent_phone, agent_name, COUNT(*) as listing_count, MAX(created_at) as last_listing_date FROM listings WHERE agent_phone IS NOT NULL GROUP BY agent_phone ORDER BY listing_count DESC");
    res.json({ success: true, data: agents });
});

app.get('/api/groups', authenticate, async (req, res) => {
    const groups = await dbAll("SELECT group_name, COUNT(*) as listing_count, MAX(created_at) as last_update FROM listings GROUP BY group_name ORDER BY last_update DESC");
    res.json({ success: true, data: groups });
});

// Static files
app.use(express.static(path.resolve(__dirname, '../../dashboard/dist')));
app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.resolve(__dirname, '../../dashboard/dist/index.html')));

app.listen(port, () => console.log(`Secure server running at http://localhost:${port}`));
