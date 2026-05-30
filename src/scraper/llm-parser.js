// Free LLM parser via Groq's free tier (Llama 3.1 8B Instant).
// Falls back to the regex parser if no API key or LLM call fails.
// Supports any language WhatsApp listings come in: English, Arabic, Hindi,
// Urdu, Tagalog, etc. — no hardcoded location lists.

require('dotenv').config();
const { MessageParser: RegexParser } = require('./message-parser');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You extract structured real-estate listings from WhatsApp messages.
Messages may be in English, Arabic, Hindi, Urdu, or mixed languages from any market.

Return ONLY a JSON object (no markdown fences) with these fields:
{
  "is_listing": boolean,           // false if not a real-estate post
  "intent": "rent"|"sale"|"wanted"|"roommate"|null,
  "property_type": "apartment"|"villa"|"townhouse"|"studio"|"penthouse"|"plot"|"office"|"shop"|null,
  "unit_type": "BHK"|"RK"|"BK"|"BR"|null,  // room config label: BHK, RK, BK, BR — extracted from the message; null for studio/unknown
  "bedrooms": number|null,         // numeric count only: 1BHK→1, 2RK→2, studio→0
  "bathrooms": number|null,
  "area_sqft": integer|null,
  "area_sqm": integer|null,
  "price": number|null,            // numeric value only
  "currency": "AED"|"INR"|"USD"|"GBP"|"EUR"|null,
  "rent_period": "yearly"|"monthly"|"weekly"|null,
  "community": string|null,        // LOCATION NAME — see rules below
  "area_text": string|null,        // verbatim location text as written in the message
  "furnished": "furnished"|"semi-furnished"|"unfurnished"|null,
  "amenities": string[],           // ["pool","gym","parking","maids-room",…]
  "vacant": boolean|null,
  "agent_phone": string|null,      // DIGITS ONLY — strip ALL non-digit chars including +, spaces, dashes, and any @domain suffix (e.g. "@c.us", "@lid", "@s.whatsapp.net"). Output "971501234567", never "+971-50 123@c.us".
  "confidence": number             // your own 0-1 confidence in this extraction
}

NOT A PROPERTY LISTING — check this FIRST, before anything else:
If the message is not a real-estate post — a vehicle (car/bike/scooter: "2018 model", "km driven",
"chalu/chalo condition", "RC", "insurance"), a job/hiring post, a product/service ad, or general chat —
you MUST return: is_listing=false, intent=null, confidence=0, and null for price, community, area_text.
Do NOT force a property interpretation onto a non-property message. A vehicle priced "4500k" is NOT a
4,500,000 rent; a job "salary 18k" is NOT an 18,000 rent.
Examples (note the null/0 output):
  "2018 model\n4500k chalo huiii hai\n95k" → {"is_listing":false,"intent":null,"price":null,"confidence":0}
  "Urgent hiring: delivery boys, salary 18k/month, call 98xxxxxxxx" → {"is_listing":false,"intent":null,"price":null,"confidence":0}
  "Selling iPhone 13 128gb, 45k, mint condition" → {"is_listing":false,"intent":null,"price":null,"confidence":0}

INTENT DETECTION — follow this decision tree, stop at first match:
1. "wanted"/"looking for"/"need"/"require"/"searching" → intent = "wanted"
2. "roommate"/"flatmate"/"room partner"/"room share" → intent = "roommate"
3. Explicit rent signal — any of: "rent","renting","lease","for rent","available","per month","pm","pcm","/m",
   "monthly","deposit","advance","bhk"/"rk" (Indian residential units always imply rent unless sale keyword present)
   → intent = "rent"
4. Explicit sale signal — "for sale","sale price","selling","buy","purchase","resale","price negotiable" → intent = "sale"
5. No clear signal → intent = null   (do NOT guess; null is better than wrong)

IMPORTANT: A standalone price like "28,000" or "45k" in an Indian BHK message almost always means monthly RENT,
not a sale price. Indian residential property sale prices start at ₹10–20 Lakh (1,000,000+). If price < 5,00,000 INR
and property is described with BHK/RK/furnished → assume intent = "rent" unless "sale"/"sell" is explicit.

CURRENCY DETECTION — follow this decision tree in order, stop at first match:
1. Explicit symbol/word present:
   - ₹ or "Rs" or "INR" anywhere → currency = "INR"
   - "Lakh"/"Lac"/"L" or "Cr"/"Crore" anywhere → currency = "INR"
   - "AED" or "Dirham" or "درهم" anywhere → currency = "AED"
   - "$" or "USD" anywhere → currency = "USD"
2. Unit type is an Indian housing term (case-insensitive):
   - Message contains "BHK", "RK", "BK", "1RK", "2RK", "3RK", "1BHK", "2BHK", "3BHK" → currency = "INR"
   - Message contains "Sector", "Society", "Nagar", "Vihar", "Colony", "Enclave" → currency = "INR"
3. Location is a well-known Dubai area:
   - "Marina", "JBR", "Downtown", "JLT", "Business Bay", "Jumeirah", "DIFC", "Palm", "Deira", "Bur Dubai" → currency = "AED"
4. Nothing matches → currency = null (do NOT guess)

LOCATION EXTRACTION — the most important field:
- In Indian/Gulf WhatsApp messages the LOCATION almost always appears FIRST (first line or first phrase), before the config.
- Messages often have each item on its own line — treat the first non-descriptor line as the location.
- SKIP these words when looking for location: "independent", "semi", "furnished", "unfurnished", "available", "vacant", "rent", "sale", "for", "only".
- "Independent" means standalone/detached unit type — it is NEVER a location name.
  Single-line examples:
    "Alpha 2 Independent 2RK Rent 21k" → community="Alpha 2"
    "Sector 14 3BHK available 25k" → community="Sector 14"
    "Alpha2, 3bhk, semi furnished, 28,000" → community="Alpha2"
    "JLT cluster M 2BR for rent" → community="JLT cluster M"
  Multi-line examples (each item on its own line — VERY COMMON in Indian WhatsApp groups):
    "Alpha 2\nIndependent\nSemi furnished\n1bhk\nRent 12.5k only" → community="Alpha 2" (first line = location; "Independent" is unit descriptor)
    "Sector 5\nVilla\n3BHK\nAvailable\n45k" → community="Sector 5"
    "Green Park\nFlat for rent\n2BHK\n25000/month" → community="Green Park"
  Rule: community = the first line/phrase that is a PLACE NAME (area, sector, society, phase, tower).
  Set BOTH community (normalised) AND area_text (verbatim as written).

UNIT TYPE RULES:
- unit_type: extract EXACTLY as written — "BHK", "RK", "BK", "BR"
  - "1BHK","2BHK","3BHK","1bhk","2bhk" → unit_type="BHK"
  - "1RK","2RK","1rk","2rk" → unit_type="RK"
  - "1BK","2BK" → unit_type="BK"
  - "1BR","2BR","3BR" → unit_type="BR"
  - studio/1RHK/bachelor → unit_type=null, bedrooms=0, property_type="studio"
- bedrooms: always the NUMBER only (1, 2, 3…). Never encode the type here.

Other rules:
- If price is in "k", treat as ×1000. "L"/"Lakh"/"Lac" = ×100,000. "Cr"/"Crore" = ×10,000,000.
- CRITICAL — never round prices. "18.5k" → price: 18500 (NOT 19000). "21.5k" → 21500. "1.25L" → 125000. Preserve all decimal precision exactly.
- rent_period: "monthly" if "/month","pm","per month","pcm" or price looks like a monthly amount. "yearly" if "per year","pa","annual" present.
- furnished: return "semi-furnished" when message says "semi furnished"/"semi-furnished"/"partly furnished". NEVER map "semi furnished" to "furnished" — they are different.
- Confidence < 0.2 if the text doesn't look like a real-estate listing.
- Return the object even when most fields are null — set is_listing=false.`;

// Sliding-window throttle: keep us under Groq's 30 req/min + 6000 TPM caps.
// We aim for ~25 req/min and let the queue drain rather than burst.
const RATE_LIMIT_PER_MIN = 25;
const _callTimestamps = [];

async function _waitForRateLimit() {
  const now = Date.now();
  const cutoff = now - 60_000;
  while (_callTimestamps.length && _callTimestamps[0] < cutoff) _callTimestamps.shift();
  if (_callTimestamps.length >= RATE_LIMIT_PER_MIN) {
    const oldest = _callTimestamps[0];
    const wait = oldest + 60_000 - now + 250;  // +250ms safety
    await new Promise(r => setTimeout(r, wait));
    return _waitForRateLimit();
  }
  _callTimestamps.push(now);
}

class LlmParser {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || process.env.GROQ_API_KEY || '';
    this.model = opts.model || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    this.maxTokens = opts.maxTokens || 512;
    this.regexFallback = new RegexParser();
    this.enabled = !!this.apiKey;
    // In-process cache by sha256(text) — same message re-parsed = free
    this._cache = new Map();
    this._cacheLimit = 5000;
  }

  _cacheKey(text) {
    // simple djb2 hash — good enough for dedup, faster than crypto
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
    return h >>> 0;
  }

  async parse(text, senderName) {
    if (!text || text.length < 4) {
      return this._emptyResult(text, senderName);
    }

    // Fast path: clearly-not-listing messages
    // 1. Short with no real-estate signals
    if (text.length < 20 && !/(\d+\s*(BHK|BR|BK|RK|sqft|sqm|k))/i.test(text)) {
      const r = this.regexFallback.parse(text, senderName);
      r.extracted_by = 'regex';
      return r;
    }
    // 2. Message is just a URL (WhatsApp invites, links, etc.)
    const stripped = text.trim();
    if (/^https?:\/\/\S+$/.test(stripped) || /^https?:\/\/\S+\s*$/.test(stripped)) {
      return { ...this._emptyResult(text, senderName), extracted_by: 'regex', confidence: 0 };
    }
    // 3. Base64 / image data (starts with /9j/ = JPEG or similar)
    if (/^\/9j\//i.test(stripped) || /^iVBORw0KGgo/i.test(stripped)) {
      return { ...this._emptyResult(text, senderName), extracted_by: 'regex', confidence: 0 };
    }

    // Content-hash cache: same text seen before? return cached
    const ck = this._cacheKey(text);
    if (this._cache.has(ck)) {
      const cached = this._cache.get(ck);
      return { ...cached, agent_name: senderName };  // re-attach sender
    }

    if (this.enabled) {
      try {
        await _waitForRateLimit();
        const result = await this._llmParse(text);
        result.agent_name = senderName;
        result.description = this._summary(text);
        result.extracted_by = `llm-groq:${this.model}`;
        // cache the result (without sender)
        if (this._cache.size >= this._cacheLimit) {
          // evict the oldest by deleting the first key
          const firstKey = this._cache.keys().next().value;
          this._cache.delete(firstKey);
        }
        const cacheable = { ...result };
        delete cacheable.agent_name;
        this._cache.set(ck, cacheable);
        return result;
      } catch (err) {
        // 429 → fall back to regex but don't spam logs
        const isRate = err.message && err.message.includes('429');
        if (!isRate) console.warn('[llm-parser] groq failed, falling back to regex:', err.message.slice(0, 200));
      }
    }
    const r = this.regexFallback.parse(text, senderName);
    r.extracted_by = 'regex';
    return r;
  }

  // Re-query the LLM after a conflict is detected.
  // `conflicts` is an array of { field, llmVal, regexVal } objects generated
  // dynamically from the actual message — nothing is hardcoded.
  async parseWithContext(text, senderName, conflicts) {
    if (!this.enabled || !conflicts || conflicts.length === 0) return null;
    await _waitForRateLimit();

    // Build a conflict summary from the regex findings — entirely dynamic
    const conflictLines = conflicts.map(c => {
      const label = c.field.replace(/_/g, ' ');
      return `  • ${label}: deterministic parser found "${c.regexVal}"` +
             (c.llmVal != null ? ` — you extracted "${c.llmVal}"` : ' — you returned null');
    }).join('\n');

    const augmented = `${text}

---
A deterministic rule-based parser cross-checked this same message and found discrepancies with your initial extraction:
${conflictLines}

Please re-read the original message carefully. If the deterministic values align with the text, use them.
If they don't, explain why in a "debug" field and keep your original values.
Return ONLY valid JSON in the same schema as before.`;

    try {
      const result = await this._llmParse(augmented);
      result.agent_name  = senderName;
      result.extracted_by = `llm-groq:${this.model}:recheck`;
      return result;
    } catch {
      return null;
    }
  }

  async _llmParse(text) {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 4000) }, // truncate huge forwards
      ],
      max_tokens: this.maxTokens,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    };

    // 30s abort so a hung Groq call doesn't pin a worker forever
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let json;
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
      }

      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq returned no content');

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON from a code-fenced response
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Groq returned non-JSON');
      parsed = JSON.parse(m[0]);
    }

    return this._normaliseLlmOutput(parsed, null);
  }

  // Public so dual-parser can normalise Gemini's raw JSON through the same path
  _normaliseLlmOutput(parsed, senderName) {
    // Crash this listing's confidence if the LLM explicitly said it isn't a
    // real estate message. The DB-side filter then drops it from the
    // dashboard, but we still keep the row for analytics/debug.
    const isListing = parsed.is_listing;
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    const adjustedConfidence = isListing === false ? 0 : confidence;

    return {
      is_listing: isListing ?? null,
      intent: parsed.intent ?? null,
      // NEVER default property_type — let nulls flow through so the dashboard
      // filter can detect non-properties (bikes, services, classified ads,
      // etc.) that the LLM correctly refused to classify.
      property_type: parsed.property_type ?? null,
      unit_type: this._normUnitType(parsed.unit_type),
      bedrooms: parsed.bedrooms ?? null,
      bathrooms: parsed.bathrooms ?? null,
      area_sqft: parsed.area_sqft ?? null,
      area_sqm: parsed.area_sqm ?? null,
      price: parsed.price ?? null,
      currency: parsed.currency ?? null,
      rent_period: parsed.rent_period ?? null,
      community: parsed.community ?? null,
      area_text: parsed.area_text ?? null,
      location: parsed.community || parsed.area_text || null,
      furnished: this._normFurnished(parsed.furnished),
      amenities: Array.isArray(parsed.amenities) ? parsed.amenities : [],
      vacant: parsed.vacant ?? null,
      agent_phone: parsed.agent_phone ?? null,
      agent_name: senderName || null,
      confidence: adjustedConfidence,
      parking: parsed.amenities?.some(a => /parking/i.test(a)) ? 1 : 0,
      raw_llm_json: parsed,
    };
  }

  // Returns canonical TEXT value matching the DB schema — never an integer
  _normFurnished(v) {
    if (v == null) return null;
    if (typeof v === 'boolean') return v ? 'furnished' : 'unfurnished';
    const s = String(v).toLowerCase().trim();
    if (s === '0') return 'unfurnished';
    if (s === '1') return 'furnished';
    if (s === '2') return 'semi-furnished';
    if (s.startsWith('un')) return 'unfurnished';
    if (s.startsWith('semi') || s.includes('part')) return 'semi-furnished';
    if (s.startsWith('furn') || s.startsWith('full')) return 'furnished';
    return null;
  }

  _normUnitType(v) {
    if (!v) return null;
    const s = String(v).toUpperCase().trim();
    if (['BHK', 'RK', 'BK', 'BR'].includes(s)) return s;
    return null;
  }

  _summary(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  _emptyResult(text, senderName) {
    return {
      is_listing: false,
      intent: null,
      property_type: null,
      bedrooms: null,
      bathrooms: null,
      area_sqft: null,
      area_sqm: null,
      price: null,
      currency: null,
      rent_period: null,
      community: null,
      area_text: null,
      location: null,
      furnished: null,
      amenities: [],
      vacant: null,
      agent_phone: null,
      agent_name: senderName,
      confidence: 0,
      parking: 0,
      description: '',
      extracted_by: 'regex',
      raw_llm_json: null,
    };
  }
}

module.exports = { LlmParser, SYSTEM_PROMPT };
