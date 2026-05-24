# WhatsApp Real Estate Group Scraper + Dashboard

Automated daily digest of real estate listings from WhatsApp groups.

## Setup

1. **Install Dependencies:**
   - npm install
   - cd dashboard && npm install && npm run build

2. **Initialize Database:**
   - npm run init-db

3. **Run Scraper (First time):**
   - npm run scrape
   - Scan the QR code with your dedicated WhatsApp account.

4. **Start the Dashboard & API:**
   - npm start
   - The dashboard will be available at http://localhost:3000.

## Project Structure

- src/scraper/: WhatsApp automation and message processing.
- src/api/: Express REST API.
- src/db/: Database schema and initialization.
- dashboard/: React + Vite frontend.
- data/db/: SQLite database storage.
