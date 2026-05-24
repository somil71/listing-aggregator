const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/db/listings.db');

function parseText(text) {
    const listing = {
        price: null,
        location: null,
        bedrooms: null,
        bathrooms: null,
        area_sqft: null,
        property_type: 'apartment',
        agent_name: null,
        agent_phone: null,
        furnished: 0,
        description: text ? text.substring(0, 500) : ''
    };

    if (!text) return listing;

    // Price extraction (e.g., ₹2.5 Cr, 50L, 5000000)
    const priceMatch = text.match(/(?:₹|Rs\.?|INR)\s*(\d+(?:\.\d+)?)\s*(Cr|L|Lakh)?/i);
    if (priceMatch) {
        let amount = parseFloat(priceMatch[1]);
        const unit = priceMatch[2] ? priceMatch[2].toLowerCase() : '';
        if (unit.includes('cr')) amount *= 10000000;
        else if (unit.includes('l')) amount *= 100000;
        listing.price = amount;
    }

    // BHK / Bedrooms extraction
    const bhkMatch = text.match(/(\d+)\s*(?:BHK|BR|Bedroom)/i);
    if (bhkMatch) {
        listing.bedrooms = parseInt(bhkMatch[1]);
    }

    // Phone number extraction
    const phoneMatch = text.match(/(?:\+91|0)?\s*([6-9]\d{9})/);
    if (phoneMatch) {
        listing.agent_phone = phoneMatch[1];
    }

    // Location extraction - very basic, usually needs a list of areas or LLM
    // For now, let's look for common keywords
    const locations = ['Bandra', 'Andheri', 'Powai', 'Worli', 'Juhu', 'Colaba', 'Borivali'];
    for (const loc of locations) {
        if (text.toLowerCase().includes(loc.toLowerCase())) {
            listing.location = loc;
            break;
        }
    }

    return listing;
}

async function processRawMessages() {
    const db = new sqlite3.Database(dbPath);

    db.all("SELECT * FROM raw_messages", [], (err, rows) => {
        if (err) {
            console.error(err.message);
            return;
        }

        rows.forEach(row => {
            const parsed = parseText(row.message_text);

            db.run(`
                INSERT OR IGNORE INTO listings (
                    id, raw_message_id, price, location, bedrooms,
                    property_type, agent_phone, description, group_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                row.id, // Using same ID as raw message for simplicity
                row.id,
                parsed.price,
                parsed.location,
                parsed.bedrooms,
                parsed.property_type,
                parsed.agent_phone,
                parsed.description,
                row.group_name
            ]);
        });
        console.log(`Processed ${rows.length} messages.`);
        db.close();
    });
}

if (require.main === module) {
    processRawMessages();
}

module.exports = { parseText, processRawMessages };
