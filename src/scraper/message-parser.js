const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/db/listings.db');

class MessageParser {
    extractPrice(text) {
        if (!text) return null;
        const priceMatch = text.match(/(?:₹|Rs\.?|INR)\s*(\d+(?:\.\d+)?)\s*(Cr|L|Lakh)?/i);
        if (priceMatch) {
            let amount = parseFloat(priceMatch[1]);
            const unit = priceMatch[2] ? priceMatch[2].toLowerCase() : '';
            if (unit.includes('cr')) amount *= 10000000;
            else if (unit.includes('l')) amount *= 100000;
            return amount;
        }
        return null;
    }

    extractPhone(text) {
        if (!text) return null;
        const phoneMatch = text.match(/(?:\+91|0)?\s*([6-9]\d{9})/);
        return phoneMatch ? phoneMatch[1] : null;
    }

    extractBedrooms(text) {
        if (!text) return null;
        const bhkMatch = text.match(/(\d+)\s*(?:BHK|BR|Bedroom)/i);
        return bhkMatch ? parseInt(bhkMatch[1]) : null;
    }

    extractLocation(text) {
        if (!text) return null;
        const LOCATIONS = {
            mumbai: [
                'Bandra', 'Andheri', 'Powai', 'Malad', 'Borivali', 'Vile Parle',
                'Dadar', 'Navi Mumbai', 'Thane', 'Mira Road', 'Virar', 'Kharghar',
                'Panvel', 'Belapur', 'Worli', 'Lower Parel', 'Mahim', 'Juhu',
                'Bandra West', 'Bandra East', 'Marine Lines', 'Colaba'
            ],
            delhi: [
                'Gurgaon', 'Noida', 'Dwarka', 'Indirapuram', 'Greater Noida',
                'East Delhi', 'West Delhi', 'South Delhi', 'North Delhi',
                'Rohini', 'Sector 62', 'Sector 63', 'DLF', 'Golf Course Road'
            ],
            bangalore: [
                'Whitefield', 'Koramangala', 'Indiranagar', 'Sarjapur',
                'Mahadevapura', 'Bellandur', 'HSR Layout', 'Marathahalli',
                'Jubilee Hills', 'Banashankari', 'Ashok Nagar'
            ],
            pune: [
                'Hinjewadi', 'Kalyani Nagar', 'Kharadi', 'Baner', 'Wakad',
                'Viman Nagar', 'Magarpatta', 'Pune City', 'Hadapsar', 'Pimple Saudagar'
            ]
        };
        const allLocations = Object.values(LOCATIONS).flat();
        for (const location of allLocations) {
            const regex = new RegExp(`\\b${location}\\b`, 'i');
            if (regex.test(text)) {
                return location;
            }
        }
        return null;
    }

    guessType(text) {
        if (!text) return 'apartment';
        const lower = text.toLowerCase();
        if (lower.includes('villa')) return 'villa';
        if (lower.includes('plot') || lower.includes('land')) return 'plot';
        if (lower.includes('commercial') || lower.includes('shop')) return 'commercial';
        if (lower.includes('office space') || lower.includes('office')) return 'office';
        if (lower.includes('pg') || lower.includes('co-living')) return 'pg';
        if (lower.includes('apt') || lower.includes('apartment') || lower.includes('flat') || lower.includes('bhk')) {
            return 'apartment';
        }
        return 'apartment';
    }

    extractArea(text) {
        if (!text) return null;
        const sqftMatch = text.match(/(\d+(?:,\d+)?)\s*(?:sqft|sq\.?ft|sq\.?feet)/i);
        if (sqftMatch) return parseInt(sqftMatch[1].replace(/,/g, ''));

        const sqmMatch = text.match(/(\d+(?:,\d+)?)\s*(?:sq\.?m|sqm|m\^2)/i);
        if (sqmMatch) {
            const sqm = parseInt(sqmMatch[1].replace(/,/g, ''));
            return sqm < 500 ? Math.round(sqm * 10.764) : sqm;
        }

        const altMatch = text.match(/(\d{3,})\s*(?:sqft|sq\.?ft)/i);
        if (altMatch) return parseInt(altMatch[1]);

        return null;
    }

    isFurnished(text) {
        if (!text) return null;
        const lower = text.toLowerCase();
        if (lower.includes('unfurnished')) return 0;
        if (lower.includes('furnished') || lower.includes('fully furnished') || lower.includes('semi-furnished') || lower.includes('semi furnished')) return 1;
        return null;
    }

    hasParking(text) {
        if (!text) return 0;
        const patterns = [
            /parking/i,
            /covered\s*parking/i,
            /1\s*parking|2\s*parking|3\s*parking/i,
            /car\s*park/i,
            /garage/i,
            /with\s*(?:covered\s*)?parking/i
        ];
        return patterns.some(p => p.test(text)) ? 1 : 0;
    }

    calculateConfidence(parsed) {
        let score = 0;
        if (parsed.price) score += 0.25;
        if (parsed.location) score += 0.20;
        if (parsed.agent_phone) score += 0.25;
        if (parsed.bedrooms) score += 0.10;
        if (parsed.property_type) score += 0.08;
        if (parsed.area_sqft) score += 0.07;
        if (parsed.agent_name) score += 0.05;
        return Math.min(score, 1.0);
    }

    generateSummary(text) {
        if (!text) return '';
        let cleaned = text.replace(/[^\w\s₹,.\-()]/g, ' ').trim();
        let summary = cleaned.split(/[.\n]/)[0].substring(0, 80);
        return summary || text.substring(0, 60);
    }

    parse(text, senderName) {
        const parsed = {
            price: this.extractPrice(text),
            location: this.extractLocation(text),
            bedrooms: this.extractBedrooms(text),
            property_type: this.guessType(text),
            area_sqft: this.extractArea(text),
            furnished: this.isFurnished(text),
            parking: this.hasParking(text),
            agent_phone: this.extractPhone(text),
            agent_name: senderName,
            description: this.generateSummary(text)
        };
        parsed.confidence = this.calculateConfidence(parsed);
        return parsed;
    }
}

const parserInstance = new MessageParser();

function parseText(text) {
    return parserInstance.parse(text);
}

async function processRawMessages() {
    const db = new sqlite3.Database(dbPath);
    const parser = new MessageParser();

    db.all("SELECT * FROM raw_messages", [], (err, rows) => {
        if (err) {
            console.error(err.message);
            return;
        }

        rows.forEach(row => {
            const parsed = parser.parse(row.message_text, row.sender_name);

            db.run(`
                INSERT OR IGNORE INTO listings (
                    id, raw_message_id, price, location, bedrooms,
                    property_type, area_sqft, furnished, parking,
                    agent_phone, agent_name, description, group_name,
                    extraction_confidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                row.id,
                row.id,
                parsed.price,
                parsed.location,
                parsed.bedrooms,
                parsed.property_type,
                parsed.area_sqft,
                parsed.furnished,
                parsed.parking,
                parsed.agent_phone,
                parsed.agent_name,
                parsed.description,
                row.group_name,
                parsed.confidence
            ]);
        });
        console.log(`Processed ${rows.length} messages.`);
        db.close();
    });
}

if (require.main === module) {
    processRawMessages();
}

module.exports = { MessageParser, parseText, processRawMessages };
