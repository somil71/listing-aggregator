# Property Digest — Complete System Documentation

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Project Directory Structure](#4-project-directory-structure)
5. [Database Schema](#5-database-schema)
6. [Authentication System (Clerk)](#6-authentication-system-clerk)
7. [Backend API](#7-backend-api)
8. [WhatsApp Connection Flow](#8-whatsapp-connection-flow)
9. [Real-Time Communication via SSE](#9-real-time-communication-via-sse)
10. [WhatsApp Scraping & Message Processing](#10-whatsapp-scraping--message-processing)
11. [Message Parser & Intelligence](#11-message-parser--intelligence)
12. [Frontend Application](#12-frontend-application)
13. [React Hooks](#13-react-hooks)
14. [Page & Component Breakdown](#14-page--component-breakdown)
15. [Full User Flow (End-to-End)](#15-full-user-flow-end-to-end)
16. [Environment Variables](#16-environment-variables)
17. [How to Run Locally](#17-how-to-run-locally)

---

## 1. What This System Does

Property Digest is a real estate intelligence platform. It connects to WhatsApp groups where agents post property listings, automatically extracts structured data from natural-language messages, and presents those listings in a searchable dashboard.

**The core problem it solves:** Real estate agents in India post listings in informal WhatsApp group messages like *"3bhk 1800sqft Bandra West 4.5cr semi furnished call 9876543210"*. There is no structured database. This system reads those messages, parses them into structured records (price, location, BHK, area, agent contact), and stores them in a queryable database.

**Key capabilities:**
- Each user connects their own WhatsApp account via QR code scan
- Users choose which groups to monitor
- Listings arrive in real-time as messages are sent
- A daily catch-up scrape runs at 06:00 to backfill any missed messages
- A daily digest summarizes market activity at 23:00
- The dashboard shows all listings for today with filtering, search, and detail view

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                           │
│                                                                 │
│  React SPA (Vite + Tailwind)                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │  LoginPage  │  │ DashboardPage│  │    SettingsPage     │    │
│  └─────────────┘  └──────────────┘  └─────────────────────┘    │
│        │                │                      │                │
│  ┌─────▼────────────────▼──────────────────────▼──────────┐    │
│  │              Clerk (Auth Provider)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│        │                │                                       │
│  JWT Bearer Token   SSE stream (?token=...)                     │
└────────┼────────────────┼────────────────────────────────────────
         │                │
┌────────▼────────────────▼────────────────────────────────────────
│                    Express Server (Node.js)                      │
│                                                                  │
│  Middleware: authenticate / authenticateSSE (Clerk token verify) │
│                                                                  │
│  /api/v1/whatsapp/*  → whatsapp routes                          │
│  /api/listings/*     → listing queries                          │
│  /api/scraper/*      → scraper status                           │
│  /api/agents         → agent queries                            │
│  /api/groups         → group queries                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │              WhatsAppService (singleton)                │     │
│  │  Map<userId, Client>   — one WhatsApp client per user   │     │
│  │  Map<userId, res>      — one SSE connection per user    │     │
│  │  Map<userId, lastState>— last event for replay          │     │
│  └────────────────────────────────────────────────────────┘     │
│                         │                                        │
│              whatsapp-web.js (Puppeteer / headless Chrome)       │
└─────────────────────────┼────────────────────────────────────────
                          │  WhatsApp Web protocol (WebSocket)
                          ▼
                   WhatsApp servers
                          │
                  Real estate groups
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend framework | React 18 + TypeScript | UI components and state |
| Frontend build | Vite 4 | Fast dev server, bundling |
| Styling | Tailwind CSS v3 | Utility-first CSS |
| CSS processing | PostCSS + Autoprefixer | Required to process `@tailwind` directives |
| Routing | React Router v6 | Client-side page navigation |
| Auth (frontend) | `@clerk/react` | ClerkProvider, useAuth, UserButton, SignIn |
| Auth (backend) | `@clerk/backend` | `createClerkClient`, `verifyToken` |
| Backend framework | Express.js | REST API + SSE endpoints |
| WhatsApp automation | `whatsapp-web.js` | Headless WhatsApp Web via Puppeteer |
| Headless browser | Puppeteer (bundled) | Runs Chrome in server memory |
| Database | SQLite3 | Local file-based relational DB |
| Scheduling | `node-cron` | Daily scrape and digest jobs |
| ID generation | `uuid` | Row primary keys |
| QR rendering | `qrcode` | Converts raw WA QR string to PNG data URL |
| HTTP client | `axios` | Listings API calls from frontend |

---

## 4. Project Directory Structure

```
listing-aggregator/
│
├── .env                          # Server env vars (Clerk keys, PORT)
├── documentation.md              # This file
│
├── data/                         # Runtime data (gitignored)
│   ├── db/
│   │   └── listings.db           # SQLite database file
│   ├── media/                    # Downloaded image/video attachments
│   └── wwebjs-auth/
│       └── <userId>/             # Per-user Puppeteer session files
│
├── db/
│   └── migrations/
│       └── addUsersTables.sql    # Creates whatsapp_sessions + selected_groups tables
│
├── src/
│   ├── api/
│   │   ├── server.js             # Express app entry point
│   │   ├── db-helpers.js         # Promise wrappers for SQLite (dbGet, dbAll, dbRun)
│   │   ├── middleware/
│   │   │   └── auth.js           # Clerk token verification middleware
│   │   ├── routes/
│   │   │   └── whatsapp.js       # All /api/v1/whatsapp/* route handlers
│   │   └── services/
│   │       └── whatsappService.js # Per-user WhatsApp client manager
│   │
│   └── scraper/
│       ├── message-parser.js     # NLP-style text extraction engine
│       ├── whatsapp-scraper.js   # Scraping orchestration + cron jobs
│       └── whatsapp-client.js    # Shared global WhatsApp client (scraper)
│
└── dashboard/                    # React frontend
    ├── .env.local                # VITE_CLERK_PUBLISHABLE_KEY
    ├── postcss.config.js         # Enables Tailwind CSS processing
    ├── tailwind.config.js        # Content paths for purging unused CSS
    ├── vite.config.ts            # Vite config with /api proxy to :3000
    ├── dist/                     # Built static files served by Express
    └── src/
        ├── main.tsx              # Root: ClerkProvider wraps App
        ├── App.tsx               # Router with ProtectedRoute
        ├── vite-env.d.ts         # TypeScript types for import.meta.env
        ├── hooks/
        │   ├── useWhatsAppApi.ts # HTTP wrapper with Clerk auth headers
        │   ├── useSSE.ts         # EventSource hook for SSE stream
        │   └── useWhatsAppAuth.ts # Polls /status, exposes connection state
        ├── pages/
        │   ├── LoginPage.tsx     # Clerk SignIn component
        │   ├── DashboardPage.tsx # Listings table + ConnectWhatsAppButton
        │   └── SettingsPage.tsx  # Connection info + group management
        └── components/
            ├── ConnectWhatsAppButton.tsx  # Connect button or green status badge
            ├── QRModal.tsx                # SSE-driven QR display modal
            └── GroupSelectionModal.tsx    # Group checkbox picker
```

---

## 5. Database Schema

The database lives at `data/db/listings.db` (SQLite).

### `raw_messages`
Stores every WhatsApp message verbatim before any parsing.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | WhatsApp message serial ID |
| `group_name` | TEXT | Name of the WhatsApp group |
| `sender_name` | TEXT | Author phone/JID |
| `message_text` | TEXT | Full raw message body |
| `timestamp` | DATETIME | When the message was sent |
| `has_images` | INTEGER | 1 if message had media |
| `image_count` | INTEGER | How many media files |
| `image_paths` | TEXT | JSON array of local file paths |

### `listings`
Structured property data extracted from raw messages.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Same as `raw_message_id` |
| `raw_message_id` | TEXT | FK to raw_messages |
| `price` | INTEGER | Price in rupees |
| `location` | TEXT | Extracted area name |
| `bedrooms` | INTEGER | BHK count |
| `property_type` | TEXT | flat / apartment / villa / plot / office / etc. |
| `area_sqft` | INTEGER | Area in square feet |
| `furnished` | INTEGER | 1=furnished, 0=unfurnished |
| `parking` | INTEGER | 1=parking available |
| `agent_phone` | TEXT | Extracted phone number |
| `agent_name` | TEXT | Sender name |
| `description` | TEXT | Full message body (for display) |
| `group_name` | TEXT | Source group |
| `extraction_confidence` | REAL | 0–1 parser confidence score |
| `image_paths` | TEXT | JSON array of downloaded media |
| `created_at` | DATETIME | Insert timestamp |

### `whatsapp_sessions`
Tracks each user's WhatsApp connection state. One row per user.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT UNIQUE | Clerk user ID (`sub` from JWT) |
| `status` | TEXT | `pending` / `qr_ready` / `ready` / `disconnected` |
| `phone` | TEXT | Connected phone number |
| `updated_at` | DATETIME | Last status change |

### `selected_groups`
Which WhatsApp groups each user has chosen to monitor.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT | Clerk user ID |
| `group_id` | TEXT | WhatsApp group JID (e.g., `12345@g.us`) |
| `group_name` | TEXT | Human-readable group name |
| `created_at` | DATETIME | When the selection was made |

> **Unique constraint:** `(user_id, group_id)` — a user cannot add the same group twice.

### `scraper_status`
Single-row table (id=1) tracking the global scraper client state.

### `digests`
Daily summaries generated at 23:00 by the cron job.

---

## 6. Authentication System (Clerk)

The app uses [Clerk](https://clerk.com) for identity. Every user has a Clerk account and a unique user ID (format: `user_xxxxxxxx`).

### How authentication flows

```
Browser (React)                    Server (Express)
     │                                    │
     │  1. User signs in via Clerk UI     │
     │     (SignIn component)             │
     │                                    │
     │  2. Clerk issues a JWT             │
     │     stored in browser memory       │
     │                                    │
     │  3. useAuth().getToken()           │
     │     fetches a fresh short-lived    │
     │     JWT on every request           │
     │                                    │
     │──── Authorization: Bearer <JWT> ──►│
     │                                    │
     │                  4. authenticate() middleware:
     │                     - Extracts JWT from header
     │                     - Calls clerk.verifyToken(token)
     │                     - Sets req.userId = payload.sub
     │                     - Calls next() or returns 401
     │                                    │
     │◄─── 200 / 401 ─────────────────────│
```

### `authenticate` middleware (`src/api/middleware/auth.js`)

Used on all normal API endpoints:
```js
const token = req.headers.authorization?.split(' ')[1];
const payload = await clerk.verifyToken(token);
req.userId = payload.sub;  // Clerk user ID is now on req for all handlers
```

### `authenticateSSE` middleware

The browser's `EventSource` API **cannot set custom HTTP headers**. So the Clerk token is passed as a URL query parameter instead:
```
GET /api/v1/whatsapp/qr-stream?token=<clerk_jwt>
```
The middleware reads `req.query.token` and verifies it the same way. This is safe because HTTPS encrypts the URL.

### Frontend auth (`@clerk/react`)

- `ClerkProvider` in `main.tsx` wraps the entire app, enabling hooks everywhere
- `useAuth().isSignedIn` — boolean, whether user is authenticated
- `useAuth().getToken()` — returns a fresh JWT (async)
- `useAuth().isLoaded` — true once Clerk has initialized and checked session
- `UserButton` — pre-built dropdown for profile/sign-out
- `SignIn` — pre-built sign-in form component

---

## 7. Backend API

All routes are in `src/api/server.js` and `src/api/routes/whatsapp.js`. All routes (except the SSE stream) require an `Authorization: Bearer <token>` header.

### WhatsApp Routes (`/api/v1/whatsapp/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/qr-stream` | SSE token in query | Opens SSE event stream for QR progress |
| `POST` | `/initiate-qr` | Bearer header | Starts a new WhatsApp session for this user |
| `GET` | `/status` | Bearer header | Returns current connection state |
| `GET` | `/groups` | Bearer header | Returns all WhatsApp groups on connected phone |
| `POST` | `/select-groups` | Bearer header | Saves chosen groups to DB |
| `POST` | `/disconnect` | Bearer header | Destroys WhatsApp session |

### Listing Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/listings/today` | Bearer | Today's listings with optional filters + pagination |
| `GET` | `/api/listings/:id` | Bearer | Single listing with original raw message |
| `GET` | `/api/agents` | Bearer | All known agents with listing counts |
| `GET` | `/api/groups` | Bearer | All groups with listing counts |
| `GET` | `/api/scraper/status` | Bearer | Global scraper connection status |

#### `/api/listings/today` query parameters

| Param | Type | Description |
|---|---|---|
| `location` | string | Filter by exact location name |
| `min_price` | number | Minimum price in rupees |
| `max_price` | number | Maximum price in rupees |
| `property_type` | string | flat / apartment / villa / etc. |
| `agent_phone` | string | Filter by agent phone number |
| `furnished` | `true`/`false` | Filter furnished status |
| `min_confidence` | number (0–1) | Minimum parser confidence (default: 0.5) |
| `limit` | number | Page size (default: 100) |
| `offset` | number | Pagination offset (default: 0) |

---

## 8. WhatsApp Connection Flow

This is the most complex part of the system. The flow connects a user's real phone to the server using `whatsapp-web.js`, which automates WhatsApp Web in a headless Chromium browser.

### Step-by-step flow

```
Frontend (React)                          Backend                         WhatsApp
      │                                      │                               │
      │ 1. User clicks "Connect WhatsApp"    │                               │
      │                                      │                               │
      │ 2. QRModal opens                     │                               │
      │    api.getStreamUrl() fetches        │                               │
      │    token and builds SSE URL          │                               │
      │                                      │                               │
      │──── GET /qr-stream?token=... ───────►│                               │
      │                                      │ authenticateSSE verifies token│
      │                                      │ registerSSE(userId, res)      │
      │◄─── event: connected ───────────────│                               │
      │    (streamReady = true)              │                               │
      │                                      │                               │
      │ 3. streamReady triggers              │                               │
      │    api.initiateQR() call             │                               │
      │──── POST /initiate-qr ─────────────►│                               │
      │                                      │ Creates new Client()          │
      │                                      │ LocalAuth(userId)             │
      │                                      │ client.initialize()           │
      │◄─── 200 { status: initializing } ──│                               │
      │                                      │────── launches Chromium ─────►│
      │                                      │                               │
      │                                      │◄──── QR code string ─────────│
      │◄──── event: qr_generated ───────────│                               │
      │      data: { image: "data:..." }     │ saves to DB: status=qr_ready  │
      │                                      │                               │
      │ 4. QRModal renders the QR image     │                               │
      │    User opens phone WhatsApp         │                               │
      │    Linked Devices → Link a Device    │                               │
      │    Scans the QR                      │                               │
      │                                      │◄──── scan confirmed ─────────│
      │◄──── event: authenticated ──────────│                               │
      │                                      │ clients.set(userId, client)   │
      │                                      │ saves to DB: status=ready     │
      │                                      │                               │
      │ 5. QRModal transitions to           │                               │
      │    GroupSelectionModal               │                               │
      │──── GET /groups ───────────────────►│                               │
      │                                      │ client.getChats()             │
      │                                      │ filters isGroup === true      │
      │◄─── 200 { groups: [...] } ──────────│                               │
      │                                      │                               │
      │ 6. User selects groups              │                               │
      │──── POST /select-groups ───────────►│                               │
      │     { groupIds, groupNames }         │ DELETE old rows               │
      │                                      │ INSERT new rows               │
      │◄─── 200 { saved: N } ──────────────│                               │
      │                                      │                               │
      │ 7. Modal closes, dashboard shows    │                               │
      │    green "Connected ✓" badge         │                               │
```

### Session persistence

`whatsapp-web.js` uses `LocalAuth` with `clientId = userId` and `dataPath = data/wwebjs-auth/<userId>/`. This saves Chromium's WhatsApp Web session cookies to disk. On next server restart, if the session is still valid, the QR scan step is **skipped** — the client reconnects automatically.

### Per-user isolation

Each user gets a completely independent `Client` instance stored in `WhatsAppService.clients` (a `Map`). There is no sharing of WhatsApp sessions between users. Each has their own:
- Chromium process (via Puppeteer)
- Auth directory on disk
- SSE connection
- DB rows in `whatsapp_sessions` and `selected_groups`

---

## 9. Real-Time Communication via SSE

### Why SSE instead of WebSocket

Server-Sent Events (SSE) is simpler for one-directional push (server → browser). There is no need for bi-directional communication during QR flow — the server pushes events, the browser listens. SSE works natively over HTTP with no extra protocol upgrade.

### How SSE works

The server writes newline-delimited event strings to an open HTTP response:
```
event: qr_generated
data: {"image":"data:image/png;base64,..."}

event: authenticated
data: {"message":"Connected!","phone":"918888888888"}

```

The browser receives these via `EventSource`. Each named event is a `addEventListener(type, handler)` call.

### SSE event types

| Event | When emitted | Data |
|---|---|---|
| `connected` | Immediately on stream open | `{}` |
| `qr_generated` | When WhatsApp generates a QR code | `{ image: "data:..." }` |
| `scanning` | When `getGroups()` is called | `{ message: "..." }` |
| `authenticated` | When QR is scanned and session is ready | `{ phone: "...", message: "..." }` |
| `groups_detected` | After getChats() runs | `{ count: N }` |
| `groups_saved` | After selectGroups() saves to DB | `{ count: N, message: "..." }` |
| `disconnected` | When WhatsApp disconnects | `{ message: "..." }` |
| `error` | On any failure | `{ message: "..." }` |

### State replay on reconnect

`WhatsAppService` maintains a `lastState` Map. Every time `_emit()` is called, it stores `{ event, data }` for that user. When `registerSSE()` is called (i.e., the frontend opens the stream), if there is already a `lastState`, it is **immediately replayed**. This means:
- If the QR was generated before the browser opened the stream, the browser still gets the QR
- If the user navigates away and back, they see the current state without waiting

---

## 10. WhatsApp Scraping & Message Processing

### Two modes of ingestion

**Real-time (event-driven):**
```js
client.on('message', async (msg) => {
  const chat = await msg.getChat();
  if (!chat.isGroup || !isPropertyGroup(chat.name)) return;
  await processMessage(msg, chat.name);
});
```
Every new message that arrives in a WhatsApp group is checked. If the group name contains property keywords (`property`, `real estate`, `flat`, `bhk`, `rent`, `sale`, etc.), it is immediately parsed and stored.

**Batch scrape (catch-up):**
```js
async function scrapeGroups() {
  const chats = await client.getChats();
  const propertyGroups = chats.filter(c => c.isGroup && isPropertyGroup(c.name));
  for (const group of propertyGroups) {
    const messages = await group.fetchMessages({ limit: 100 });
    for (const msg of messages) {
      await processMessage(msg, group.name);
    }
  }
}
```
Runs: on server startup (catch-up), and daily at 06:00 via cron.

### `processMessage` — the shared pipeline

Every message (real-time or batch) goes through the same function:

```
1. Skip if no body and no media
2. Generate messageId = msg.id._serialized (globally unique from WhatsApp)
3. Download attached media → save to data/media/<messageId>.<ext>
4. INSERT OR IGNORE into raw_messages (idempotent — same message never stored twice)
5. Parse the message text with MessageParser
6. If confidence > 0 → INSERT OR IGNORE into listings
```

The `INSERT OR IGNORE` on both tables means the same message can be processed multiple times (e.g., real-time + catch-up) without creating duplicate rows.

### Cron schedule

```
0 6 * * *   → scrapeGroups()        — Daily catch-up of last 100 messages per group
0 23 * * *  → generateDailyDigest() — Nightly market summary
```

### Daily digest

Aggregates all listings from today and stores a JSON summary including:
- Total listing count
- Average, min, max price
- Listings by location (counts)
- Listings by property type (counts)

Stored in the `digests` table with `digest_date = today`.

---

## 11. Message Parser & Intelligence

The parser (`src/scraper/message-parser.js`) converts free-text WhatsApp messages into structured records.

### How it works

The parser runs a series of regex patterns against the raw message text. It does not use any ML model — it is entirely rule-based pattern matching.

### Location matching

150+ area names across 8 Indian cities (Mumbai, Delhi, Bangalore, Pune, Hyderabad, Chennai, Kolkata, Ahmedabad) are compiled into regex patterns at module load time (not per-call). The matching is case-insensitive with word boundaries.

If no known area is found, **fuzzy patterns** catch generic location formats:
- `Sector N` (e.g., Sector 62)
- `Phase N` (e.g., Phase 2)
- Words ending in `Nagar`, `Colony`, `Layout`, `Enclave`, `Hills`

### What gets extracted

| Field | Patterns matched |
|---|---|
| `price` | `4.5cr`, `45L`, `4.5 crore`, `45 lakh`, `4500000` |
| `bedrooms` | `3bhk`, `3 bhk`, `3 bedroom`, `studio` |
| `area_sqft` | `1800sqft`, `1800 sq ft`, `1800 sq.ft` |
| `property_type` | flat, apartment, villa, plot, office, shop, rowhouse, bungalow, penthouse, duplex |
| `furnished` | furnished, semi-furnished, unfurnished, fully furnished |
| `parking` | parking, car park, covered parking |
| `agent_phone` | 10-digit Indian mobile numbers (optional +91 prefix) |
| `location` | See location matching above |

### Confidence scoring

The parser returns a `confidence` value between 0 and 1. Higher confidence means more fields were successfully extracted. Messages with `confidence === 0` (nothing useful extracted) are not stored in `listings`. The API defaults to returning only listings with `confidence >= 0.5`.

---

## 12. Frontend Application

### Entry point (`dashboard/src/main.tsx`)

```tsx
<ClerkProvider publishableKey={...}>
  <App />
</ClerkProvider>
```

`ClerkProvider` must wrap the entire app so that `useAuth()`, `useUser()`, and other Clerk hooks work anywhere in the component tree.

### Router (`dashboard/src/App.tsx`)

```
/login      → LoginPage        (public)
/dashboard  → DashboardPage    (protected)
/settings   → SettingsPage     (protected)
/*          → redirect to /dashboard
```

`ProtectedRoute` wraps protected pages. It checks `useAuth().isLoaded` (Clerk initialized) and `useAuth().isSignedIn`. If not signed in, it redirects to `/login`. If Clerk hasn't loaded yet, it shows a spinner to avoid a flash of the login screen.

### CSS pipeline

Tailwind CSS requires a PostCSS build step to process `@tailwind base/components/utilities` directives in `index.css` into real CSS. This is configured in `dashboard/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```
Without this file, Vite would output a ~0.1 kB CSS file with no styles. With it, the output is ~20 kB of processed Tailwind utilities.

### Vite proxy

`vite.config.ts` proxies all `/api/*` requests to `http://localhost:3000`, allowing the frontend dev server (port 5173) to talk to the Express backend (port 3000) without CORS issues. In production, Express serves the built React app as static files, so the proxy is irrelevant.

---

## 13. React Hooks

### `useWhatsAppApi`

Provides authenticated HTTP calls to all WhatsApp API endpoints. Each method:
1. Calls `getToken()` to get a fresh Clerk JWT
2. Attaches it as `Authorization: Bearer <token>`
3. Makes the fetch call and throws on non-2xx responses

Special method: `getStreamUrl()` builds the SSE URL with the token embedded as a query param (required because `EventSource` cannot set headers).

### `useSSE(url)`

Opens an `EventSource` connection to the given URL. Listens to all named SSE event types and stores the most recent one as `lastEvent`. Sets `streamReady = true` when the `connected` ping arrives. Cleans up on unmount or URL change. Returns `{ lastEvent, streamReady }`.

The hook is URL-driven — passing `null` prevents any connection from opening. This means a component can render the hook unconditionally and control connection by whether it passes a URL.

### `useWhatsAppAuth`

Polls `/api/v1/whatsapp/status` once on mount to get the current WhatsApp connection state. Returns:
- `isConnected` — whether a live `Client` is running for this user
- `phone` — the connected phone number
- `selectedGroups` — array of `{ group_id, group_name }`
- `selectedGroupsCount` — count of monitored groups
- `sessionStatus` — DB status string (`none` / `qr_ready` / `ready` / `disconnected`)
- `updatedAt` — timestamp of last status change
- `loading` — true until first fetch completes
- `refresh()` — re-fetches status (called after connect or disconnect)

---

## 14. Page & Component Breakdown

### `LoginPage`

Renders Clerk's pre-built `<SignIn>` component centered on a dark background. When the user is already signed in (e.g., page refresh), `useEffect` immediately redirects to `/dashboard`. Uses `forceRedirectUrl="/dashboard"` to send Clerk's post-sign-in redirect to the dashboard.

### `DashboardPage`

The main view. Contains:
- Sidebar with navigation links to Dashboard and Settings, plus `UserButton`
- Header with search input, `ConnectWhatsAppButton`, and Refresh button
- Stats row: average price, average BHK, total listings
- Listings table: property type icon, location, group source, bed/area config, price, view button
- Detail modal: full listing info with Call Agent and WhatsApp direct link buttons

Listings are fetched from `/api/listings/today` on mount and on Refresh click. Search filters happen client-side against `location` and `description` fields.

### `SettingsPage`

Displays:
- **WhatsApp Connection card**: live status indicator (green pulse if connected), phone number, session status, last update time, Disconnect button
- **Monitored Groups card** (only shown when connected): list of all selected groups with group initial icons, Edit button to open `GroupSelectionModal`

### `ConnectWhatsAppButton`

Uses `useWhatsAppAuth` to decide what to render:
- **Loading**: skeleton pulse animation
- **Connected**: green badge with phone number and group count pill
- **Not connected**: green button that opens `QRModal`

### `QRModal`

The most complex component. Manages the full WhatsApp connection lifecycle:

1. On mount: calls `api.getStreamUrl()` and sets `streamUrl` state
2. `useSSE(streamUrl)` opens the SSE stream
3. When `streamReady` becomes true: calls `api.initiateQR()` (fire-and-forget — response is just `{ status: initializing }`)
4. SSE events drive phase transitions:
   - `qr_generated` → phase `qr`, renders QR image (via `qrcode.toDataURL`)
   - `scanning` → phase `scanning`, shows spinner
   - `authenticated` → phase `authenticated`, shows checkmark, then transitions to `select_groups` after 1.2s
   - `error` / `disconnected` → phase `error`, shows message and retry button
5. When phase is `select_groups`, renders `GroupSelectionModal` in place of itself

A status log at the bottom of the modal shows the last 5 status messages in a terminal-style font.

### `GroupSelectionModal`

Fetches groups from `/api/v1/whatsapp/groups` on mount. Renders a scrollable checkbox list of all WhatsApp groups. Selected groups are tracked in a local `Set<string>`. On Save, calls `api.selectGroups(ids, names)` and calls `onSaved()`.

---

## 15. Full User Flow (End-to-End)

### First-time user

```
1. Navigate to app URL
   → ProtectedRoute detects no session
   → Redirect to /login

2. Sign up / sign in via Clerk UI
   → Clerk sets session in browser
   → Clerk redirects to /dashboard

3. Dashboard loads, shows empty listings
   Header shows "Connect WhatsApp" green button
   (useWhatsAppAuth polls status → isConnected = false)

4. Click "Connect WhatsApp"
   → QRModal opens

5. QRModal: getStreamUrl() called → gets token from Clerk → builds SSE URL
   → EventSource opens to /api/v1/whatsapp/qr-stream?token=...
   → Server emits "connected" ping → streamReady = true

6. QRModal: streamReady triggers initiateQR() POST
   → Server creates new Client with LocalAuth(userId)
   → client.initialize() fires (Puppeteer launches headless Chrome, loads WA Web)
   → WhatsApp generates QR string
   → Server emits "qr_generated" with base64 PNG
   → QRModal decodes and renders QR image

7. User opens WhatsApp on phone
   → Linked Devices → Link a Device → scans QR

8. WhatsApp Web recognizes scan
   → client "ready" event fires on server
   → Server: clients.set(userId, client), saves status=ready to DB
   → Server emits "authenticated" event with phone number
   → QRModal shows checkmark for 1.2s
   → QRModal swaps to GroupSelectionModal

9. GroupSelectionModal: GET /groups
   → Server calls client.getChats(), filters groups
   → Modal renders list of all groups

10. User checks relevant property groups → Save
    → POST /select-groups with IDs + names
    → Server: DELETE old, INSERT new rows in selected_groups
    → onSaved() closes modal

11. Dashboard: ConnectWhatsAppButton re-queries status
    → Shows green badge: "9812345678  3 groups"

12. From now on: any new message in those groups
    → client.on('message') fires
    → processMessage() checks isPropertyGroup(chat.name)
    → Parser extracts data
    → Row inserted into raw_messages + listings
    → Appears on dashboard on next Refresh
```

### Returning user (session still valid)

```
1. Navigate to app URL
   → ProtectedRoute: Clerk session exists → go to /dashboard
   → useWhatsAppAuth polls /status → isConnected = false (server restarted)

(Note: the WhatsApp client is NOT automatically reconnected on page load.
 The LocalAuth data is on disk but the Client needs to be initialized again.)

2. User clicks "Connect WhatsApp" again
   → QRModal opens, initiateQR() called
   → Client loads LocalAuth from disk
   → If session is still valid: client.ready fires WITHOUT QR
   → "authenticated" SSE arrives, QRModal closes immediately
```

---

## 16. Environment Variables

### Server (`.env` in project root)

```env
PORT=3000
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

- `PORT`: Express server port (default 3000)
- `CLERK_SECRET_KEY`: Used by `@clerk/backend` to verify JWTs server-side. **Never expose this to the browser.**
- `CLERK_PUBLISHABLE_KEY`: Also needed server-side for some Clerk operations.

### Frontend (`dashboard/.env.local`)

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

- Must be prefixed with `VITE_` for Vite to expose it to the browser bundle via `import.meta.env`
- This is the public-safe key — safe to embed in client code

---

## 17. How to Run Locally

### Prerequisites

- Node.js 18+ (tested on v24 — run `npm rebuild sqlite3` after install if on a newer version)
- Chromium / Chrome installed (Puppeteer downloads its own, no action needed)
- A WhatsApp account on a phone (not your primary account — use a secondary SIM)

### Install

```bash
# Root dependencies (Express, whatsapp-web.js, Clerk backend, etc.)
npm install

# Frontend dependencies
cd dashboard && npm install && cd ..
```

### Build frontend

```bash
cd dashboard && npm run build && cd ..
```

The built files go to `dashboard/dist/` and are served as static files by Express.

### Start server

```bash
node src/api/server.js
```

The server:
1. Runs DB migrations (`addUsersTables.sql`) idempotently
2. Starts listening on `http://localhost:3000`
3. Serves the React app at `/` (any non-API route serves `dist/index.html`)

### Development (hot-reload)

```bash
# Terminal 1: backend
node src/api/server.js

# Terminal 2: frontend dev server (proxies /api to :3000)
cd dashboard && npm run dev
```

Open `http://localhost:5173` for the Vite dev server with hot module replacement.

### First run checklist

1. `data/db/` directory is auto-created by SQLite on first query
2. `data/wwebjs-auth/` is auto-created by LocalAuth on first `client.initialize()`
3. `data/media/` is auto-created by `downloadMedia()` on first media message
4. Open the app, sign in, click "Connect WhatsApp", scan QR with your phone
5. Select your property groups and save
6. Messages from those groups will now be scraped in real-time
