# WhatsApp Real Estate Group( Scraper + Dashboard )

Automated daily digest of real estate listings from WhatsApp groups.

## 😊 Project Overview

This project automates the extraction of real estate listings from multiple WhatsApp groups and presents them in a clean, searchable, and filterable web dashboard.

## ✅ Project Status

### Completed
- **WhatsApp Scraper Core:** Full integration with `whatsapp-web.js`. Handles authentication via QR code and persists sessions using `LocalAuth`.
- **Group Filtering:** Logic to automatically identify and scrape groups containing "Property", "Real Estate", "Listing", or "Deal".
- **Database Architecture:** SQLite setup with three layers: `raw_messages`, `listings`, and `digests`.
- **Message Parser:** Regex-based parser for Indian currency formats (₹, Cr, L), BHK counts, and 10-digit Indian phone numbers.
- **Backend API:** Express server with endpoints for daily listings, full-text search, and group monitoring.
- **Frontend Dashboard:** React dashboard with stats cards, filterable listings table, and detail view modal with direct call/WhatsApp links.
- **Static Integration:** Backend serves the production-built frontend as a single-process deployment.


### Pending / Simplified
- **LLM Integration:** Logic is structured for Claude API (Anthropic), but requires a user-provided API key.
- **Image Storage:** Identifies messages with images; actual disk-storage of binary blobs simplified to metadata tracking.
- **Authentication:** Dashboard is currently accessible to anyone on the local network.

## 👂 File Structure

"``text
/
┘├├ dashboard/              # React + TypeScript + Vite Frontend
│   ├├├ src/
│   │   ├├├ App.txx         # Main Dashboard Logic & UI
│   │   \xe2\x9dt├├ index.css       # Tailwind Directives
│   \xe2\x9dt├├ dist/               # Production build files
┘├├ data/
│   \xe2\x94\xe2\x94\xe2\x94 db/                 # SQLite database storage (listings.db)
│   \xe2\x97T\xe2\x94\xe2\x94 wwebjs-auth/        # WhatsApp session persistence
\xe2\x94\xe2\x94\xe2\x94 src/
┘├├ api/
┘├├ server.js       #express API & Static Server
\xe2\x94\xe2\x94\xe2\x94 db/
│   ├├├ init.js         # Database initialization script
│   \xe2\x97T\xe2\x94\xe2\x94 schema.sql      # SQL table definitions
\xe2\x9dt├├ scraper/
┘├├ whatsapp-client.js # Whatsapp bot initialization
├├├ whatsapp-scraper.js # Group scraping logic
\xe2\x97T\xe2\x94\xe2\x94 message-parser.js  # Text-to-Structured-Data logic
\xe2\x94\xe2\x94\xe2\x94 package.json            # Root configuration & scripts
\xe2\x9dt├├ REAE5.md               # User documentation
```

## 💺 Technical Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Lucide React, Axios.
- **Backend:** Node.js, Express.js.
- **Database:** SQLite3 (Serverless, local file-based).
- **Automation:** `whatsapp-web.js` (built on Puppeteer/Chromium).

## 🕔 Basic Logic & Data Flow

1.  **Extraction:** Scans joined chats, filters for "Property" groups, and fetches the last 100 messages. Saves into `raw_messages`.
2.  **Processing:** Reads from `raw_messages`, applies regex patterns to extract **Price**, **BHK**, **Location**, and **Agent Phone Number**. Structured data is saved to `listings`.
3.  **Consumption:** The Express API queries the `listings` table. The React Dashboard fetches and renders this data.

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
   ```

3. **Run Scraper (First time):**
   ```bash
   npm run scrape
   ```
   Scan the QR code with your dedicated WhatsApp account.

4. **Start the Dashboard & API:**
   ```bash
   npm start
   ```
   The dashboard will be available at http://localhost:3000.

## 〫 Automation

Set up a cron job to run the scraper daily:
```bash
0 6 * * * cd /path/to/project && /usr/bin/npm run scrape >> logs/scrape.log 2>&1
```
