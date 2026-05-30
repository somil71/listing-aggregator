const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/db/listings.db');

// Location database keyed by market, each entry carries:
//   currency — the ISO 4217 code for that market
//   areas    — list of well-known locality / neighbourhood names
//
// Currency is derived purely from where the property is located.
// Explicit symbols in the message (₹, AED, $) always take priority;
// the location table is used only when no symbol is present.
const MARKETS = {
  // ── India ──────────────────────────────────────────────────────────────────
  mumbai:    { currency: 'INR', areas: [
    'Bandra', 'Bandra West', 'Bandra East', 'Andheri', 'Andheri West', 'Andheri East',
    'Jogeshwari', 'Goregaon', 'Malad', 'Kandivali', 'Borivali', 'Dahisar',
    'Mira Road', 'Virar', 'Vasai', 'Nalasopara', 'Bhayander',
    'Chembur', 'Ghatkopar', 'Mulund', 'Bhandup', 'Vikhroli', 'Kurla', 'Sion',
    'Dadar', 'Mahim', 'Worli', 'Lower Parel', 'Parel',
    'Colaba', 'Marine Lines', 'Nariman Point', 'Cuffe Parade',
    'Juhu', 'Vile Parle', 'Santacruz', 'Lokhandwala', 'Versova', 'Oshiwara',
    'Navi Mumbai', 'Thane', 'Powai', 'Kharghar', 'Panvel', 'Belapur',
    'Nerul', 'Vashi', 'Airoli', 'Ghansoli', 'Turbhe', 'Koparkhairane',
    'Dombivli', 'Kalyan', 'Ulhasnagar', 'Ambernath', 'Badlapur',
  ]},
  delhi:     { currency: 'INR', areas: [
    'Gurgaon', 'Gurugram', 'DLF', 'Golf Course Road', 'Sohna Road', 'Dwarka Expressway',
    'Noida', 'Greater Noida', 'Indirapuram', 'Sector 62', 'Sector 63',
    'Sector 137', 'Sector 150', 'Sector 75', 'Noida Extension',
    'Crossings Republik', 'Raj Nagar Extension',
    'Dwarka', 'Rohini', 'Pitampura', 'Janakpuri', 'Rajouri Garden',
    'East Delhi', 'West Delhi', 'South Delhi', 'North Delhi',
    'Vasant Kunj', 'Saket', 'Lajpat Nagar', 'Connaught Place',
    'Nehru Place', 'Hauz Khas', 'Green Park', 'Defence Colony',
    'Greater Kailash', 'Malviya Nagar', 'Jasola', 'Okhla',
    'Mayur Vihar', 'Preet Vihar', 'Patparganj', 'Shahdara',
    'Faridabad', 'Ghaziabad', 'Vasundhara', 'Vaishali',
    // Greater Noida Greek-letter sectors (common WhatsApp shorthand)
    'Alpha 1', 'Alpha 2', 'Beta 1', 'Beta 2', 'Gamma 1', 'Gamma 2',
    'Delta 1', 'Delta 2', 'Delta 3', 'Omicron 1', 'Omicron 2', 'Omicron 3',
    'Eta 1', 'Eta 2', 'Pi 1', 'Pi 2', 'Mu 1', 'Mu 2', 'Sigma 1', 'Sigma 2',
    'Chi 1', 'Chi 2', 'Chi 3', 'Chi 4', 'Chi 5',
    'Phi 1', 'Phi 2', 'Phi 3', 'Phi 4',
    'Knowledge Park', 'Pari Chowk', 'Jagat Farm',
  ]},
  bangalore: { currency: 'INR', areas: [
    'Whitefield', 'Mahadevapura', 'Marathahalli', 'Bellandur', 'Sarjapur', 'Sarjapur Road',
    'Electronic City', 'Old Madras Road', 'Kadugodi',
    'Yelahanka', 'Hebbal', 'Devanahalli', 'Thanisandra', 'RT Nagar', 'Hennur', 'Kalyan Nagar',
    'Kanakapura Road', 'JP Nagar', 'Bannerghatta Road',
    'Kengeri', 'Mysore Road', 'Tumkur Road', 'Rajajinagar', 'Malleshwaram',
    'Basaveshwara Nagar', 'Nagarbhavi', 'Vijayanagar',
    'Indiranagar', 'Koramangala', 'HSR Layout', 'Jayanagar', 'BTM Layout',
    'Banashankari', 'Ashok Nagar', 'Richmond Town', 'MG Road', 'Frazer Town',
    'Benson Town', 'Shivaji Nagar', 'Seshadripuram', 'Sadashivanagar', 'Outer Ring Road',
  ]},
  pune:      { currency: 'INR', areas: [
    'Hinjewadi', 'Wakad', 'Baner', 'Balewadi', 'Aundh', 'Pashan', 'Sus', 'Punawale',
    'Ravet', 'Tathawade',
    'Kharadi', 'Viman Nagar', 'Kalyani Nagar', 'Wagholi', 'Hadapsar',
    'Magarpatta', 'Keshav Nagar', 'Koregaon Park',
    'Undri', 'Kondhwa', 'Wanowrie', 'Bibwewadi',
    'Kothrud', 'Warje', 'Bavdhan', 'Paud Road',
    'Deccan', 'Camp', 'Sadashiv Peth', 'Pimple Saudagar',
    'Pimple Nilakh', 'Chikhali', 'Bhosari', 'Pune City',
  ]},
  hyderabad: { currency: 'INR', areas: [
    'Hitech City', 'HITEC City', 'Madhapur', 'Kondapur', 'Gachibowli',
    'Financial District', 'Kokapet', 'Nanakramguda', 'Manikonda', 'Narsingi',
    'Kukatpally', 'Miyapur', 'Nizampet', 'Bachupally', 'Chandanagar', 'Hafeezpet', 'KPHB',
    'Banjara Hills', 'Jubilee Hills', 'Panjagutta', 'Ameerpet',
    'Somajiguda', 'Begumpet', 'Secunderabad', 'Marredpally', 'Tarnaka',
    'LB Nagar', 'Uppal', 'Nagole', 'Kothapet', 'Dilsukhnagar',
    'Mehdipatnam', 'Attapur', 'Tolichowki', 'Kompally', 'Medchal',
  ]},
  chennai:   { currency: 'INR', areas: [
    'Anna Nagar', 'Kilpauk', 'Aminjikarai', 'Perambur', 'Kolathur',
    'Nungambakkam', 'T Nagar', 'Egmore', 'Royapettah', 'Mylapore', 'Mandaveli', 'Adyar',
    'Thiruvanmiyur', 'Velachery', 'Perungudi', 'Sholinganallur', 'Pallikaranai',
    'Chromepet', 'Tambaram', 'Pallavaram', 'Porur',
    'OMR', 'ECR', 'Thoraipakkam', 'Siruseri',
    'Guindy', 'Ashok Nagar', 'KK Nagar', 'Vadapalani',
    'Besant Nagar', 'Neelankarai',
  ]},
  kolkata:   { currency: 'INR', areas: [
    'Ballygunge', 'Gariahat', 'Jadavpur', 'Dhakuria', 'Tollygunge', 'Alipore', 'Behala', 'Garia',
    'Dumdum', 'Lake Town', 'Baranagar', 'Agarpara',
    'Park Street', 'Esplanade', 'Phoolbagan', 'Ultadanga',
    'Salt Lake', 'New Town', 'Rajarhat', 'Sector V',
    'Howrah',
  ]},
  ahmedabad: { currency: 'INR', areas: [
    'Satellite', 'Prahlad Nagar', 'Bodakdev', 'Vastrapur', 'Thaltej',
    'Bopal', 'South Bopal', 'Shela', 'Shilaj',
    'Navrangpura', 'CG Road', 'Paldi', 'Ellis Bridge',
    'Chandkheda', 'Motera', 'Sabarmati', 'Gota', 'Tragad',
    'Maninagar', 'Naroda', 'Vastral', 'SG Highway', 'Sola',
  ]},

  // ── UAE / Dubai ────────────────────────────────────────────────────────────
  dubai: { currency: 'AED', areas: [
    'Dubai Marina', 'Marina', 'JBR', 'Jumeirah Beach Residence',
    'Downtown Dubai', 'Downtown', 'Burj Khalifa', 'Burj Area',
    'Business Bay', 'DIFC', 'Dubai International Financial Centre',
    'JLT', 'Jumeirah Lake Towers',
    'JVC', 'Jumeirah Village Circle',
    'JVT', 'Jumeirah Village Triangle',
    'Palm Jumeirah', 'Palm',
    'Jumeirah', 'Jumeirah 1', 'Jumeirah 2', 'Jumeirah 3',
    'Al Barsha', 'Al Barsha 1', 'Al Barsha 2', 'Al Barsha 3',
    'Deira', 'Bur Dubai', 'Karama', 'Al Karama', 'Satwa', 'Al Satwa',
    'Mirdif', 'Al Mirdif', 'Rashidiya', 'Al Rashidiya',
    'Muhaisnah', 'Al Qusais', 'Al Nahda',
    'Dubai Silicon Oasis', 'DSO', 'Silicon Oasis',
    'Dubai Sports City', 'Motor City', 'IMPZ',
    'Dubailand', 'Arjan', 'Al Furjan', 'Discovery Gardens',
    'The Greens', 'The Views', 'The Springs', 'The Meadows', 'The Lakes',
    'Emirates Hills', 'Arabian Ranches', 'Mudon', 'Reem',
    'Damac Hills', 'Akoya', 'Tilal Al Ghaf',
    'Creek Harbour', 'Dubai Creek', 'Ras Al Khor',
    'International City', 'Dragon Mart',
    'Al Khail Gate', 'Remraam', 'Layan',
    'Jumeirah Golf Estates', 'Dubai Hills', 'Dubai Hills Estate',
    'Mohammed Bin Rashid City', 'MBR City', 'Sobha Hartland',
    'Culture Village', 'Jaddaf', 'Al Jaddaf',
    'Trade Centre', 'Sheikh Zayed Road', 'SZR',
    'Festival City', 'Al Khawaneej',
    'Al Warsan', 'International Media Production Zone', 'IMPZ',
  ]},
  abudhabi: { currency: 'AED', areas: [
    'Reem Island', 'Al Reem Island',
    'Yas Island', 'Saadiyat Island', 'Al Saadiyat',
    'Al Raha Beach', 'Al Raha', 'Khalifa City', 'Khalifa City A', 'Khalifa City B',
    'Al Reef', 'Masdar City', 'Mohammed Bin Zayed City', 'MBZ City',
    'Corniche', 'Al Corniche', 'Al Zahiyah', 'Tourist Club Area',
    'Al Mushrif', 'Al Muroor', 'Al Karamah', 'Al Khalidiyah',
    'Electra Street', 'Hamdan Street',
    'Al Ain', 'Mussafah', 'Baniyas',
    'Rawdhat', 'Al Rawdah', 'Al Manaseer',
    'Sas Al Nakhl', 'Al Shamkha', 'Al Falah',
  ]},
  sharjah: { currency: 'AED', areas: [
    'Al Nahda Sharjah', 'Al Taawun', 'Al Khan', 'Al Majaz',
    'Muwailih', 'Halwan', 'Rolla', 'Al Qasimia',
    'Al Yarmook', 'Sharjah Industrial', 'Al Jurf',
  ]},

  // ── United Kingdom ─────────────────────────────────────────────────────────
  london: { currency: 'GBP', areas: [
    'Canary Wharf', 'City of London', 'The City',
    'Shoreditch', 'Hackney', 'Bethnal Green', 'Stepney',
    'Brixton', 'Clapham', 'Balham', 'Tooting', 'Streatham',
    'Peckham', 'Camberwell', 'Dulwich', 'Forest Hill',
    'Islington', 'Angel', 'Highbury', 'Holloway',
    'Hammersmith', 'Shepherd\'s Bush', 'Ealing', 'Acton',
    'Wimbledon', 'Putney', 'Richmond', 'Twickenham',
    'Greenwich', 'Lewisham', 'Deptford', 'New Cross',
    'Stratford', 'Ilford', 'Barking', 'Dagenham',
    'Wembley', 'Harrow', 'Edgware', 'Stanmore',
    'Tottenham', 'Wood Green', 'Edmonton', 'Enfield',
    'Croydon', 'Sutton', 'Morden', 'Kingston',
    'Kensington', 'Chelsea', 'Fulham', 'Battersea',
    'Southwark', 'Bermondsey', 'Borough', 'London Bridge',
    'Elephant and Castle', 'Vauxhall', 'Stockwell',
    'Notting Hill', 'Bayswater', 'Paddington', 'Maida Vale',
    'Mayfair', 'Marylebone', 'Fitzrovia', 'Soho', 'Covent Garden',
    'King\'s Cross', 'Euston', 'Camden', 'Kentish Town',
    'Finchley', 'Barnet', 'East Finchley', 'Golders Green',
  ]},

  // ── USA ─────────────────────────────────────────────────────────────────────
  // Note: US listings almost always use $ explicitly; location matching is a
  // belt-and-suspenders fallback for when no symbol appears.
  new_york: { currency: 'USD', areas: [
    'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island',
    'Harlem', 'Midtown', 'Upper West Side', 'Upper East Side',
    'Lower East Side', 'East Village', 'West Village', 'Greenwich Village',
    'SoHo', 'Tribeca', 'Financial District', 'Battery Park City',
    'Williamsburg', 'Bushwick', 'Crown Heights', 'Flatbush', 'Bed-Stuy',
    'Park Slope', 'Carroll Gardens', 'Red Hook', 'DUMBO',
    'Flushing', 'Astoria', 'Long Island City', 'Jackson Heights',
    'Jersey City', 'Hoboken',
  ]},
  los_angeles: { currency: 'USD', areas: [
    'Santa Monica', 'Venice', 'Culver City', 'West Hollywood',
    'Beverly Hills', 'Bel Air', 'Brentwood', 'Pacific Palisades',
    'Silver Lake', 'Echo Park', 'Los Feliz', 'Hollywood',
    'Koreatown', 'Westlake', 'Downtown LA',
    'Pasadena', 'Glendale', 'Burbank', 'Studio City',
    'Encino', 'Sherman Oaks', 'Van Nuys', 'North Hollywood',
    'Long Beach', 'Compton', 'Inglewood', 'Torrance',
    'Irvine', 'Anaheim', 'Fullerton',
  ]},
};

// Build a flat lookup: { name, currency, regex }
// Spaces in location names are made optional so "Alpha2" matches "Alpha 2".
const ALL_LOCATIONS = [];
for (const [, market] of Object.entries(MARKETS)) {
  for (const area of market.areas) {
    const escaped = area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexed  = escaped.replace(/ /g, '\\s*');
    ALL_LOCATIONS.push({
      name:     area,
      currency: market.currency,
      regex:    new RegExp(`\\b${flexed}\\b`, 'i'),
    });
  }
}

// Keep the old LOCATIONS export for any code that still uses it
const LOCATIONS = Object.fromEntries(
  Object.entries(MARKETS).map(([k, v]) => [k, v.areas])
);

// Fuzzy patterns for areas not in the list (Indian naming conventions)
const FUZZY_PATTERNS = [
  /\b(\w[\w\s]+?(?:\s+Nagar|\s+Colony|\s+Layout|\s+Enclave|\s+Extension|\s+Vihar|\s+Township))\b/i,
  /\b(Sector\s*[-–]?\s*\d+[A-Z]?)\b/i,
  /\b(Phase\s*[-–]?\s*[1-9I]{1,3})\b/i,
];

class MessageParser {
  extractPrice(text) {
    if (!text) return null;
    this._lastCurrency = null; // explicit detection only; null = unknown

    // AED patterns (Dubai market)
    let m = text.match(/(?:AED|aed|درهم)\s*(\d+(?:[,.]?\d+)*(?:\.\d+)?)\s*(M|K|k)?/i);
    if (m) {
      this._lastCurrency = 'AED';
      return this._scaleAmount(parseFloat(m[1].replace(/,/g, '')), m[2]);
    }
    // "95k AED" / "95,000 AED"
    m = text.match(/(\d+(?:[,.]?\d+)*(?:\.\d+)?)\s*(M|K|k)?\s*(?:AED|aed|درهم)/i);
    if (m) {
      this._lastCurrency = 'AED';
      return this._scaleAmount(parseFloat(m[1].replace(/,/g, '')), m[2]);
    }

    // INR patterns
    m = text.match(/(?:₹|Rs\.?|INR)\s*(\d+(?:[,.]?\d+)*(?:\.\d+)?)\s*(Cr|Crore|L|Lakh|Lac|k|K)?/i);
    if (m) { this._lastCurrency = 'INR'; return this._scaleAmount(parseFloat(m[1].replace(/,/g, '')), m[2]); }

    // "12k" bare — check context for Indian market signals before defaulting
    m = text.match(/\b(\d+(?:[,.]?\d+)*(?:\.\d+)?)\s*(k|K)\b/);
    if (m) {
      // Indian housing unit type (BHK, RK, BK) in same message → INR
      if (/\b\d*\s*(?:BHK|RK|BK)\b/i.test(text)) this._lastCurrency = 'INR';
      return parseFloat(m[1].replace(/,/g, '')) * 1000;
    }

    // Cr/Lakh → clearly INR
    m = text.match(/\b(\d+(?:\.\d+)?)\s*(Cr|Crore|Lakh|Lac)\b/i);
    if (m) { this._lastCurrency = 'INR'; return this._scaleAmount(parseFloat(m[1]), m[2]); }

    // bare price with rent context. Allow ANY separator between the keyword and
    // the number — colon, equals, and crucially a dash/hyphen, since WhatsApp
    // listings overwhelmingly write "Rent-22500" / "Rent–14500". The previous
    // pattern only allowed whitespace/colon/equals, so every hyphenated rent
    // was silently dropped (LLM-only, no fallback) → price NULL on the dashboard.
    m = text.match(/(?:rent|price|monthly|per\s*month|pm|p\/m|cost|budget)\b[\s:=._\-–—]*(?:₹|Rs\.?|INR|AED)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|K|L|Lakh|Lac|Cr|Crore)?/i);
    if (m) {
      if (/\b\d*\s*(?:BHK|RK|BK)\b/i.test(text)) this._lastCurrency = this._lastCurrency || 'INR';
      return this._scaleAmount(parseFloat(m[1].replace(/,/g, '')), m[2]);
    }

    m = text.match(/(\d+(?:,\d+)*)\s*(?:per\s*month|pm|p\/m|\/month|monthly|month)/i);
    if (m) return parseFloat(m[1].replace(/,/g, ''));

    return null;
  }

  extractCurrency(text) {
    this.extractPrice(text); // sets this._lastCurrency as a side effect
    return this._lastCurrency || null;
  }

  // Returns { name, currency } or null
  _matchLocation(text) {
    if (!text) return null;
    for (const entry of ALL_LOCATIONS) {
      if (entry.regex.test(text)) return { name: entry.name, currency: entry.currency };
    }
    return null;
  }

  _scaleAmount(amount, unit) {
    const u = (unit || '').toLowerCase();
    if (u.startsWith('cr')) return amount * 10_000_000;
    if (u.startsWith('l') || u.startsWith('lac') || u.startsWith('lakh')) return amount * 100_000;
    if (u === 'k') return amount * 1_000;
    return amount;
  }

  extractPhone(text) {
    if (!text) return null;
    const match = text.match(/(?:\+91|0)?\s*([6-9]\d{9})/);
    return match ? match[1] : null;
  }

  extractBedrooms(text) {
    return this.extractConfig(text).bedrooms;
  }

  // Returns { bedrooms, unit_type } — the definitive config extractor.
  // Prefers the most specific match (BHK > RK > BR > generic bedroom count).
  extractConfig(text) {
    if (!text) return { bedrooms: null, unit_type: null };

    // e.g. "1bhk", "2BHK", "3 BHK", "2rk", "1RK", "2bk", "2BK"
    let m = text.match(/\b(\d+)\s*(bhk|rk|bk)\b/i);
    if (m) return { bedrooms: parseInt(m[1]), unit_type: m[2].toUpperCase() };

    // e.g. "2BR", "3 BR", "1 bedroom", "2 bedrooms"
    m = text.match(/\b(\d+)\s*(?:br|bedroom[s]?)\b/i);
    if (m) return { bedrooms: parseInt(m[1]), unit_type: 'BR' };

    // studio
    if (/\bstudio\b/i.test(text)) return { bedrooms: 0, unit_type: null };

    return { bedrooms: null, unit_type: null };
  }

  // Detect if message has rental signals (rent posts often have no price prefix)
  isRentalSignal(text) {
    if (!text) return false;
    return /\b(rent|rental|pg|paying\s*guest|flatmate|roomie|share|sharing|available|vacancy|to\s*let|tolet)\b/i.test(text);
  }

  _fuzzyLocation(text) {
    if (!text) return null;
    for (const pattern of FUZZY_PATTERNS) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }

  extractLocation(text) {
    if (!text) return null;
    // 1. Known area database (highest confidence)
    const hit = this._matchLocation(text);
    if (hit) return hit.name;
    // 2. Fuzzy patterns: Sector X, Phase X, Nagar, Colony…
    const fuzzy = this._fuzzyLocation(text);
    if (fuzzy) return fuzzy;
    // 3. First-line extraction for multiline messages
    return this.extractFirstLineLocation(text);
  }

  guessType(text) {
    if (!text) return 'apartment';
    const lower = text.toLowerCase();
    if (lower.includes('villa')) return 'villa';
    if (lower.includes('plot') || lower.includes('land')) return 'plot';
    if (lower.includes('commercial') || lower.includes('shop')) return 'commercial';
    if (lower.includes('office space') || lower.includes('office')) return 'office';
    if (lower.includes('pg') || lower.includes('co-living')) return 'pg';
    if (lower.includes('rowhouse') || lower.includes('row house')) return 'rowhouse';
    if (lower.includes('bungalow')) return 'bungalow';
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
    return null;
  }

  // Returns canonical TEXT matching the DB schema — 'furnished'|'semi-furnished'|'unfurnished'|null
  isFurnished(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (lower.includes('unfurnished') || lower.includes('un-furnished')) return 'unfurnished';
    // semi must be checked BEFORE furnished (it contains the word "furnished")
    if (lower.includes('semi-furnished') || lower.includes('semi furnished') ||
        lower.includes('semifurnished') || lower.includes('partly furnished') ||
        lower.includes('partial')) return 'semi-furnished';
    if (lower.includes('furnished') || lower.includes('fully furnished') ||
        lower.includes('full furnished')) return 'furnished';
    return null;
  }

  // Extract physical amenities / fittings the unit comes with.
  // WhatsApp listings list these as terse lines ("1bed, 1almirah and 1Ac",
  // "14 k with ac"). The LLM populates `amenities` only ~9% of the time, so we
  // run this regex pass and MERGE it into whatever the LLM returned. Returns a
  // de-duplicated array of canonical labels (matching the DB amenities TEXT[]).
  extractAmenities(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    // [canonical label, regex]. Order doesn't matter — output is de-duped.
    // Anchors are letter-only lookarounds — (?<![a-z]) / (?![a-z]) — NOT \b,
    // because listings glue the quantity to the word ("1bed", "1almirah",
    // "1Ac"); a \b never sits between a digit and a letter, so \b-anchored
    // patterns silently miss every quantified amenity. A leading digit is fine
    // (it's not a letter); a leading/trailing letter is rejected so we don't
    // match "ac" inside "place" or "bed" inside "bedroom".
    const AMENITY_PATTERNS = [
      ['AC',              /(?<![a-z])(?:a\.?c\.?|air[\s-]?cond(?:itioner|itioning)?)(?![a-z])/i],
      ['bed',             /(?<![a-z])beds?(?![a-z])/i],
      ['wardrobe',        /(?<![a-z])(?:almirah?s?|wardrobes?|cupboards?|cabinets?)(?![a-z])/i],
      ['fridge',          /(?<![a-z])(?:fridges?|refrigerators?)(?![a-z])/i],
      ['washing machine', /(?<![a-z])washing\s*machine(?![a-z])/i],
      ['geyser',          /(?<![a-z])(?:geyser|water\s*heater)(?![a-z])/i],
      ['sofa',            /(?<![a-z])sofa(?![a-z])/i],
      ['TV',              /(?<![a-z])(?:tv|television)(?![a-z])/i],
      ['dining table',    /(?<![a-z])dining\s*table(?![a-z])/i],
      ['parking',         /(?<![a-z])(?:parking|car\s*park|garage)(?![a-z])/i],
      ['lift',            /(?<![a-z])(?:lift|elevator)(?![a-z])/i],
      ['balcony',         /(?<![a-z])balcon(?:y|ies)(?![a-z])/i],
      ['modular kitchen', /(?<![a-z])modular\s*kitchen(?![a-z])/i],
      ['kitchen',         /(?<![a-z])(?:kitchen|kitchenette)(?![a-z])/i],
      ['gym',             /(?<![a-z])gym(?![a-z])/i],
      ['pool',            /(?<![a-z])(?:swimming\s*)?pool(?![a-z])/i],
      ['power backup',    /(?<![a-z])(?:power\s*backup|inverter|generator)(?![a-z])/i],
      ['water supply',    /(?<![a-z])(?:24\s*(?:hours?|hrs?)\s*water|water\s*supply|water\s*facility)(?![a-z])/i],
      ['gas pipeline',    /(?<![a-z])(?:gas\s*(?:pipeline|connection)|piped\s*gas)(?![a-z])/i],
      ['wifi',            /(?<![a-z])(?:wi-?fi|internet)(?![a-z])/i],
      ['security',        /(?<![a-z])(?:security|guard|cctv|gated)(?![a-z])/i],
    ];
    const found = new Set();
    for (const [label, re] of AMENITY_PATTERNS) {
      if (re.test(lower)) found.add(label);
    }
    return [...found];
  }

  // Returns true when str matches a known area from any market.
  isKnownLocation(str) {
    if (!str) return false;
    return ALL_LOCATIONS.some(e => e.regex.test(str));
  }

  // Extracts location from a multiline message where each item is on its own line.
  // This is the most common format in Indian WhatsApp groups.
  extractFirstLineLocation(text) {
    if (!text) return null;

    // Words/phrases that are NEVER part of a location name.
    // Uses \b (word boundary), NOT ^ (start-of-line), so it catches lines that
    // START with non-location words — e.g. "Fully Furnished" → has "furnished".
    const nonLocRe = /\b(?:furnished|unfurnished|owner|story|storey|available|vacant|for\s+(?:rent|sale)|rent|sale|lease|only|flats?|studio|villas?|apartments?|house|rooms?|pg|bachelor|single|double|triple|looking|wanted|independent|semi|bhk|rk|bk|sqft|sqm|bed|almirah?|fridge|washing|machine|sofa|geyser|wardrobe|microwave|balcon|kitchen|parking|lift|gym|pool|floor|contact|call|mob|whatsapp)\b/i;

    // Try line-by-line (multiline messages)
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      for (const line of lines) {
        if (/^\d/.test(line)) continue;          // skip lines starting with digits (prices, counts, "2 BHK")
        if (nonLocRe.test(line)) continue;        // whole-line check — rejects "Fully Furnished", "With Owner", etc.
        if (line.length < 2 || line.length > 50) continue;
        if (!/[a-zA-Z]/.test(line)) continue;
        return line.replace(/[^\w\s]/g, '').trim() || null;
      }
      // Multiline message but no valid location line found — don't fall through to
      // single-line mode or we'll pick up partial words like "Fully" from "Fully Furnished"
      return null;
    }

    // Fallback: single-line — extract text before the first non-location stop token
    const stopRe = /\b(?:independent|semi[\s-]?furnished|semi|furnished|unfurnished|available|vacant|for\s+(?:rent|sale)|rent|sale|lease|only|\d+\s*(?:bhk|rk|bk|br|bedroom|bath|sqft|sqm)|flats?|studio|apartment[s]?|house|room[s]?|villa[s]?)\b/i;
    const stop = text.match(stopRe);
    if (!stop || stop.index === 0) return null;
    const before = text.slice(0, stop.index).trim().replace(/[^\w\s]/g, '').trim();
    if (!before || before.length < 2 || before.length > 50) return null;
    if (!/[a-zA-Z]/.test(before)) return null;
    return before;
  }

  hasParking(text) {
    if (!text) return 0;
    const patterns = [
      /parking/i, /covered\s*parking/i, /[123]\s*parking/i,
      /car\s*park/i, /garage/i, /with\s*(?:covered\s*)?parking/i,
    ];
    return patterns.some(p => p.test(text)) ? 1 : 0;
  }

  calculateConfidence(parsed, text) {
    let score = 0;
    if (parsed.price) score += 0.25;
    if (parsed.location) score += 0.20;
    if (parsed.agent_phone) score += 0.20;
    if (parsed.bedrooms) score += 0.15;     // bumped — strong rental signal
    if (parsed.area_sqft) score += 0.07;
    if (parsed.agent_name) score += 0.03;
    if (parsed.furnished != null) score += 0.05;
    if (parsed.parking) score += 0.02;
    // Bonus when the message has rental/availability vocabulary AND at least
    // one structural detail (bedrooms or price).  A "1rk 12k available" post
    // is a real listing even without all fields.
    if (text && this.isRentalSignal(text) && (parsed.bedrooms || parsed.price)) {
      score += 0.10;
    }
    return Math.min(score, 1.0);
  }

  generateSummary(text) {
    if (!text) return '';
    const cleaned = text.replace(/[^\w\s₹,.\-()]/g, ' ').trim();
    return cleaned.split(/[.\n]/)[0].substring(0, 80) || text.substring(0, 60);
  }

  // True when a string is a property attribute masquerading as a place name —
  // "Independent Raw", "Fully Furnished", "2 BHK", "Separate entry", etc. These
  // routinely leak out of the LLM into the location field. Keep this in sync
  // with the dashboard's isLikelyLocation reject list (defense-in-depth there).
  _isNonLocation(str) {
    if (!str) return false;
    return /\b(?:furnished|unfurnished|owner|story|storey|available|vacant|with\s+owner|independent|raw|bare|semi|separate|seprate|entry|\d*\s*(?:bhk|rk|bk|br))\b/i.test(str);
  }

  // Validate an LLM-provided location, falling back to text extraction when the
  // candidate is missing or is actually a property attribute. Returns a clean
  // place name or null. e.g. ("Independent Raw", "Alpha 2 Independent Raw 1rk…")
  // → "Alpha 2".
  sanitizeLocation(candidate, text) {
    if (candidate && !this._isNonLocation(candidate)) return candidate;
    return this.extractLocation(text) || null;
  }

  // Single deterministic post-LLM pass shared by the live worker and the batch
  // reprocess tool. Mutates and returns `parsed`: validates/repairs location,
  // and backfills price / currency / furnished / amenities the LLM dropped.
  // Pure regex — no network, no cost — so it is safe to run on every message
  // and to re-run over the whole table.
  normalize(parsed, text) {
    parsed = parsed || {};

    // Location: validate the LLM value, repair from text, or clear if it was a
    // bad value we couldn't replace (better NULL than "Independent Raw").
    const candidate = parsed.community || parsed.area_text || parsed.location || null;
    const loc = this.sanitizeLocation(candidate, text);
    if (loc) {
      parsed.community = loc;
      parsed.area_text = loc;
      parsed.location  = loc;
    } else if (this._isNonLocation(parsed.community) || this._isNonLocation(parsed.area_text)) {
      parsed.community = null;
      parsed.area_text = null;
      parsed.location  = null;
    }

    // Price (also sets this._lastCurrency as a side effect).
    if (parsed.price == null) {
      const p = this.extractPrice(text);
      if (p != null) {
        parsed.price = p;
        if (!parsed.currency && this._lastCurrency) parsed.currency = this._lastCurrency;
      }
    }

    // Furnished.
    if (!parsed.furnished) {
      const f = this.isFurnished(text);
      if (f) parsed.furnished = f;
    }

    // Amenities — LLM populates these <10% of the time; union the regex pass in.
    const regexAmenities = this.extractAmenities(text);
    if (regexAmenities.length) {
      parsed.amenities = [...new Set([...(parsed.amenities || []), ...regexAmenities])];
    }

    // Confidence must reflect the post-backfill data. The LLM scores confidence
    // BEFORE we repair price/location, so a row we just gave a valid price+area
    // could still sit below the dashboard's min_confidence gate and be hidden.
    // Recompute and take the higher value — never lower the LLM's own score.
    const recomputed = this.calculateConfidence(parsed, text);
    if (parsed.confidence == null || recomputed > parsed.confidence) {
      parsed.confidence = recomputed;
    }

    return parsed;
  }

  parse(text, senderName) {
    const price    = this.extractPrice(text);           // also sets this._lastCurrency
    const locHit   = this._matchLocation(text);         // { name, currency } | null
    const location = locHit ? locHit.name
                             : this._fuzzyLocation(text);
    const bedrooms = this.extractBedrooms(text);

    // Priority: explicit symbol in message > location market > Indian unit type > unknown
    let currency = this._lastCurrency;                  // set by extractPrice(); null if no symbol
    if (!currency) {
      if (locHit) {
        // Location uniquely identifies the market → its currency
        currency = locHit.currency;
      } else if (/\b\d*\s*(?:BHK|RK|BK)\b/i.test(text || '')) {
        // Indian housing unit type (1RK, 2BHK, etc.) with no explicit location → INR
        currency = 'INR';
      }
      // Otherwise genuinely unknown — leave as null
    }

    const parsed = {
      price,
      currency,
      location,
      bedrooms,
      property_type: this.guessType(text),
      area_sqft: this.extractArea(text),
      furnished: this.isFurnished(text),
      amenities: this.extractAmenities(text),
      parking: this.hasParking(text),
      agent_phone: this.extractPhone(text),
      agent_name: senderName,
      description: this.generateSummary(text),
    };
    parsed.confidence = this.calculateConfidence(parsed, text);
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

  db.all('SELECT * FROM raw_messages', [], (err, rows) => {
    if (err) { console.error(err.message); return; }
    rows.forEach(row => {
      const parsed = parser.parse(row.message_text, row.sender_name);
      db.run(
        `INSERT OR IGNORE INTO listings (
          id, raw_message_id, price, location, bedrooms,
          property_type, area_sqft, furnished, parking,
          agent_phone, agent_name, description, group_name, extraction_confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.id, parsed.price, parsed.location, parsed.bedrooms,
         parsed.property_type, parsed.area_sqft, parsed.furnished, parsed.parking,
         parsed.agent_phone, parsed.agent_name, parsed.description,
         row.group_name, parsed.confidence]
      );
    });
    console.log(`Processed ${rows.length} messages.`);
    db.close();
  });
}

if (require.main === module) {
  processRawMessages();
}

module.exports = { MessageParser, parseText, processRawMessages };
