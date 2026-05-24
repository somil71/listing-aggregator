const client = require('./whatsapp-client');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.resolve(__dirname, '../../data/db/listings.db');
const db = new sqlite3.Database(dbPath);

async function scrapeGroups() {
    console.log('Fetching chats...');
    const chats = await client.getChats();
    const propertyGroups = chats.filter(chat =>
        chat.isGroup &&
        (chat.name.toLowerCase().includes('property') ||
         chat.name.toLowerCase().includes('real estate') ||
         chat.name.toLowerCase().includes('listing') ||
         chat.name.toLowerCase().includes('deal'))
    );

    console.log(`Found ${propertyGroups.length} property groups.`);

    for (const group of propertyGroups) {
        console.log(`Scraping group: ${group.name}`);
        const messages = await group.fetchMessages({ limit: 100 });

        for (const msg of messages) {
            // Only process text messages or messages with media
            if (!msg.body && !msg.hasMedia) continue;

            const messageId = msg.id._serialized;
            const timestamp = new Date(msg.timestamp * 1000).toISOString();
            const senderName = msg.author || msg.from;

            let imagePaths = [];
            if (msg.hasMedia) {
                // In a real scenario, we'd download media here.
                // For now, we'll just mark it.
            }

            db.run(`
                INSERT OR IGNORE INTO raw_messages (id, group_name, sender_name, message_text, timestamp, has_images, image_paths)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                messageId,
                group.name,
                senderName,
                msg.body,
                timestamp,
                msg.hasMedia ? 1 : 0,
                JSON.stringify(imagePaths)
            ]);
        }
    }
    console.log('Scraping completed.');
}

client.on('ready', async () => {
    await scrapeGroups();
    // In a real app, we might want to keep the client running or close it.
    // For this task, we'll keep it running for a bit then we might close it.
});

client.initialize();
