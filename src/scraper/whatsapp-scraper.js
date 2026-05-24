const client = require('./whatsapp-client');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.resolve(__dirname, '../../data/db/listings.db');
const db = new sqlite3.Database(dbPath);

// ── Keywords to match against group names (case-insensitive)
// Edit this list to match YOUR WhatsApp property group names
const PROPERTY_KEYWORDS = [
    'property', 'real estate', 'listing', 'deal',
    'flat', 'apartment', 'house', 'rent', 'buy', 'sell',
    'realty', 'plot', 'villa', 'bungalow', 'pg', 'flats',
    'housing', 'home', 'bhk', '1bhk', '2bhk', '3bhk',
    'society', 'residency', 'colony', 'nagar'
];

async function scrapeGroups() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱  Fetching all WhatsApp chats...');
    const chats = await client.getChats();

    // Log ALL groups so the user can see what keywords to add
    const allGroups = chats.filter(chat => chat.isGroup);
    console.log(`\n📂  Total groups found: ${allGroups.length}`);
    console.log('\n📋  ALL YOUR GROUPS (so you can add keywords):');
    allGroups.forEach((g, i) => console.log(`    [${i + 1}] ${g.name}`));

    // Filter by keywords
    const propertyGroups = allGroups.filter(chat =>
        PROPERTY_KEYWORDS.some(kw => chat.name.toLowerCase().includes(kw))
    );

    console.log(`\n✅  Matched ${propertyGroups.length} property-related group(s):`);
    propertyGroups.forEach(g => console.log(`    → ${g.name}`));

    if (propertyGroups.length === 0) {
        console.log('\n⚠️  No groups matched. Add your group name keywords to');
        console.log('    PROPERTY_KEYWORDS in src/scraper/whatsapp-scraper.js');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    let totalSaved = 0;
    for (const group of propertyGroups) {
        console.log(`\n⏳  Scraping: "${group.name}"`);
        const messages = await group.fetchMessages({ limit: 200 });
        console.log(`    Fetched ${messages.length} messages`);

        let saved = 0;
        for (const msg of messages) {
            if (!msg.body && !msg.hasMedia) continue;

            const messageId = msg.id._serialized;
            const timestamp = new Date(msg.timestamp * 1000).toISOString();
            const senderName = msg.author || msg.from;

            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR IGNORE INTO raw_messages 
                     (id, group_name, sender_name, message_text, timestamp, has_images, image_paths)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        messageId,
                        group.name,
                        senderName,
                        msg.body,
                        timestamp,
                        msg.hasMedia ? 1 : 0,
                        JSON.stringify([])
                    ],
                    function(err) {
                        if (err) reject(err);
                        else { if (this.changes > 0) saved++; resolve(); }
                    }
                );
            });
        }
        console.log(`    ✔  Saved ${saved} new messages from "${group.name}"`);
        totalSaved += saved;
    }

    console.log(`\n🎉  Scraping complete! ${totalSaved} new messages saved to DB.`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

client.on('ready', async () => {
    try {
        await scrapeGroups();
    } catch (err) {
        console.error('❌  Scraping error:', err.message);
    }
    // Keep alive so session is preserved for next run
});

client.initialize();
