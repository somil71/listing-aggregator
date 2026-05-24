const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const dbPath = path.resolve(__dirname, '../../data/db/listings.db');

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(dbPath);

app.get('/api/listings/today', (req, res) => {
    const query = `
        SELECT * FROM listings
        WHERE date(created_at) = date('now')
        ORDER BY created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ listings: rows });
    });
});

app.get('/api/listings/search', (req, res) => {
    const { q, location, min_price, max_price } = req.query;
    let query = "SELECT * FROM listings WHERE 1=1";
    const params = [];

    if (q) {
        query += " AND (description LIKE ? OR location LIKE ?)";
        params.push(`%${q}%`, `%${q}%`);
    }
    if (location) {
        query += " AND location = ?";
        params.push(location);
    }
    if (min_price) {
        query += " AND price >= ?";
        params.push(min_price);
    }
    if (max_price) {
        query += " AND price <= ?";
        params.push(max_price);
    }

    query += " ORDER BY created_at DESC";

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ listings: rows });
    });
});

app.get('/api/groups', (req, res) => {
    db.all("SELECT DISTINCT group_name FROM raw_messages", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ groups: rows.map(r => r.group_name) });
    });
});

// Serve static files from the React app
app.use(express.static(path.resolve(__dirname, '../../dashboard/dist')));

// Wildcard route to serve the React app for any other requests
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.resolve(__dirname, '../../dashboard/dist/index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
