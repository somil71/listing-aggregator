# WhatsApp Real Estate Group Scraper + Dashboard

Automated daily digest of real estate listings from WhatsApp groups.

## 😊 Project Overview

This project automates the extraction of real estate listings from multiple WhatsApp groups and presents them in a clean, searchable, and filterable web dashboard.

## ✅ Project Status

### Phase 1: Message Parser (Complete)
- **Regex Extraction:** Indian currency (₹, Cr, L), BHK, 10-digit phone numbers.
- **Location Matching:** Predefined list of 50+ areas in Mumbai, Delhi, Bangalore, and Pune.
- **Property Logic:** Automated detection of Property Type, Area (sqft/sqm), Furnishing, and Parking.
- **Confidence Scoring:** Logic-based scoring (0-1) to flag extraction quality.

### Phase 2: Database Schema (Complete)
- **SQLite Core:** Relational structure for raw messages and structured listings.
- **Enhanced Columns:** Dedicated fields for location, type, area, furnished, parking, and confidence.
- **Indexing:** High-performance indexes on price, location, and date for fast dashboard response.


### Phase 3: Backend API (Complete)
- **Filtering & Search:** Advanced endpoints for today's listings with price, location, and confidence filters.
- **Aggregations:** Statistics block in API for average price, area, and total counts.
- **Metadata:** Endpoints for Agent statistics and Group activity tracking.
- **Persistence:** User notes system on specific listings.


### Phase 4: Frontend Dashboard (Complete)
- **Modern UI:** React 18 + Tailwind CSS.
- **Interactive:** Filterable table, full-text search, and detail modals with direct contact links.


## 💺 Technical Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Lucide React, Axios.
- **Backend:** Node.js, Express.js.
- **Database:** SQLite3.
- **Automation:** `whatsapp-web.js` (Puppeteer).


## ⚙️ Setup Instructions

1. **Install Dependencies:**
   ```bash
   npm install
   cd dashboard && npm install && npm run build
   cd ..
   ```

2. **Initialize Database:**
   ```bash
   npm run init-db
   node src/db/migrate.js
   ```

3. **Run Scraper:**
   ```bash
   npm run scrape
   ```

4. **Start Web App:**
   ```bash
   npm start
   ```
