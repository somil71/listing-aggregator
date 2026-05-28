const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbAll } = require('../api/db-helpers');
const { MessageParser } = require('./message-parser');
const client = require('./whatsapp-client');

const MEDIA_DIR = path.resolve(__dirname, '../../data/media');
const parser = new MessageParser();

// Keywords that identify a WhatsApp group as property-related
const PROPERTY_KEYWORDS = [
  'property', 'real estate', 'listing', 'deal', 'flat', 'bhk', 'rent', 'sale', 'realty',
];

function isPropertyGroup(name) {
  const lower = name.toLowerCase();
  return PROPERTY_KEYWORDS.some(kw => lower.includes(kw));
}

function log(tag, msg) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

// --- Media Download ---

async function downloadMedia(msg, messageId) {
  if (!msg.hasMedia) return [];
  try {
    const media = await msg.downloadMedia();
    if (!media || !media.data) return [];

    const ext = (media.mimetype?.split('/')[1]?.split(';')[0]) || 'bin';
    const filename = `${messageId}.${ext}`;
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const filepath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
    log('Media', `Saved ${filename} (${media.mimetype})`);
    return [filepath];
  } catch (err) {
    log('Media', `Download failed for ${messageId}: ${err.message}`);
    return [];
  }
}

// --- Core Message Processor (shared by real-time and batch) ---

async function processMessage(msg, groupName) {
  if (!msg.body && !msg.hasMedia) return;

  const messageId = msg.id._serialized;
  const timestamp = new Date(msg.timestamp * 1000).toISOString();
  const senderName = msg.author || msg.from;
  const text = msg.body || '';

  // Download any attached images/videos
  const imagePaths = await downloadMedia(msg, messageId);

  // Store raw message (idempotent — INSERT OR IGNORE)
  await dbRun(
    `INSERT OR IGNORE INTO raw_messages
       (id, group_name, sender_name, message_text, timestamp, has_images, image_count, image_paths)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [messageId, groupName, senderName, text, timestamp,
     imagePaths.length > 0 ? 1 : 0, imagePaths.length, JSON.stringify(imagePaths)]
  );

  // Parse and immediately write to listings
  const parsed = parser.parse(text, senderName);
  if (parsed.confidence > 0) {
    await dbRun(
      `INSERT OR IGNORE INTO listings
         (id, raw_message_id, price, location, bedrooms, property_type, area_sqft,
          furnished, parking, agent_phone, agent_name, description, group_name,
          extraction_confidence, image_paths)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, messageId, parsed.price, parsed.location, parsed.bedrooms,
       parsed.property_type, parsed.area_sqft, parsed.furnished, parsed.parking,
       parsed.agent_phone, parsed.agent_name, parsed.description, groupName,
       parsed.confidence, JSON.stringify(imagePaths)]
    );
    log('Parser', `Stored listing from ${groupName} | conf=${parsed.confidence.toFixed(2)} loc=${parsed.location || 'unknown'}`);
  }
}

// --- Batch Scrape (catch-up) ---

async function scrapeGroups() {
  log('Scraper', 'Starting batch scrape...');
  try {
    const chats = await client.getChats();
    const propertyGroups = chats.filter(c => c.isGroup && isPropertyGroup(c.name));
    log('Scraper', `Found ${propertyGroups.length} property groups`);

    for (const group of propertyGroups) {
      log('Scraper', `Scraping: ${group.name}`);
      const messages = await group.fetchMessages({ limit: 100 });
      for (const msg of messages) {
        await processMessage(msg, group.name);
      }
    }
    log('Scraper', 'Batch scrape complete');
  } catch (err) {
    log('Scraper', `Batch scrape error: ${err.message}`);
  }
}

// --- Daily Digest Generator ---

async function generateDailyDigest() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const listings = await dbAll(`SELECT * FROM listings WHERE DATE(created_at) = DATE('now')`);
    const prices = listings.map(l => l.price).filter(Boolean);

    const byLocation = {};
    const byType = {};
    for (const l of listings) {
      if (l.location) byLocation[l.location] = (byLocation[l.location] || 0) + 1;
      if (l.property_type) byType[l.property_type] = (byType[l.property_type] || 0) + 1;
    }

    const summary = {
      total: listings.length,
      avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      byLocation,
      byType,
    };

    await dbRun(
      `INSERT OR REPLACE INTO digests
         (id, digest_date, listing_count, new_listings, total_price_range, summary_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), today, listings.length, listings.length,
       `${summary.minPrice}-${summary.maxPrice}`, JSON.stringify(summary)]
    );
    log('Digest', `Generated for ${today}: ${listings.length} listings`);
  } catch (err) {
    log('Digest', `Error: ${err.message}`);
  }
}

// --- Real-time Listener ---

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup || !isPropertyGroup(chat.name)) return;
    log('Real-time', `New message from "${chat.name}"`);
    await processMessage(msg, chat.name);
  } catch (err) {
    log('Real-time', `Error: ${err.message}`);
  }
});

// --- Startup ---

client.on('ready', async () => {
  // Catch-up scrape on every startup
  await scrapeGroups();

  // Daily catch-up scrape at 06:00
  cron.schedule('0 6 * * *', async () => {
    log('Cron', 'Running scheduled daily scrape');
    await scrapeGroups();
  });

  // Daily digest at 23:00
  cron.schedule('0 23 * * *', async () => {
    log('Cron', 'Generating daily digest');
    await generateDailyDigest();
  });

  log('Scraper', 'Real-time listener active. Cron: scrape@06:00, digest@23:00');
});

client.initialize();
