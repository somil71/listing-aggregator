// Multi-layer parser — 4-stage pipeline:
//
//  Stage 1: Run LLM (Groq) + Regex in parallel
//  Stage 2: Detect conflicts between them (location, price, bedrooms, furnished)
//  Stage 3: If conflicts → re-query LLM with regex findings as DYNAMIC hints
//           (hints come from the actual message data — nothing hardcoded)
//  Stage 4: Final merge — regex wins for structured deterministic fields,
//           LLM wins for free-form fields (intent, amenities, etc.)
//
// The dual Groq+Gemini path is preserved when Gemini is available.

require('dotenv').config();
const { LlmParser } = require('./llm-parser');
const { GeminiParser } = require('./gemini-parser');
const { MessageParser: RegexParser } = require('./message-parser');

const groqParser   = new LlmParser();
const geminiParser = new GeminiParser();
const regexParser  = new RegexParser();

// ─── Conflict detection ───────────────────────────────────────────────────────
// Returns an array of { field, llmVal, regexVal } for every significant mismatch.
// All values come from the actual parsed message — zero hardcoding.

function detectConflicts(llm, regex) {
  const conflicts = [];
  if (!llm || !regex) return conflicts;

  // ── Location ──────────────────────────────────────────────────────────────
  const regexLoc = regex.location || null;
  const llmLoc   = llm.community  || llm.area_text || null;

  if (regexLoc) {
    // Regex found a known/first-line location.
    if (!llmLoc) {
      // LLM missed it entirely.
      conflicts.push({ field: 'community', llmVal: null, regexVal: regexLoc });
    } else if (llmLoc.toLowerCase() !== regexLoc.toLowerCase()) {
      // LLM found something different — is the LLM value actually a known location?
      const llmIsKnown = regexParser.isKnownLocation(llmLoc);
      if (!llmIsKnown) {
        // LLM invented an unknown location while regex found a recognised one → conflict
        conflicts.push({ field: 'community', llmVal: llmLoc, regexVal: regexLoc });
      }
    }
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  const regexPrice = regex.price != null ? parseFloat(regex.price) : NaN;
  const llmPrice   = llm.price   != null ? parseFloat(llm.price)   : NaN;
  if (!isNaN(regexPrice) && !isNaN(llmPrice) && regexPrice > 0 && llmPrice > 0) {
    const ratio = Math.max(regexPrice, llmPrice) / Math.min(regexPrice, llmPrice);
    if (ratio > 1.25) {
      conflicts.push({ field: 'price', llmVal: llmPrice, regexVal: regexPrice });
    }
  }

  // ── Bedrooms / unit_type ─────────────────────────────────────────────────
  const regexCfg = regexParser.extractConfig(
    // We need raw text — regex.description carries the summary, not original.
    // The caller (parse()) passes the raw text separately; here we compare
    // what the regex already extracted vs what the LLM extracted.
    // Note: regex.bedrooms and regex.unit_type come from the full parse() call.
    null  // placeholder — handled below in parse() where raw text is available
  );
  // Actual comparison is done where raw text is available (see parse())

  // ── Furnished ─────────────────────────────────────────────────────────────
  const regexFurn = regex.furnished;
  const llmFurn   = llm.furnished;
  if (regexFurn && llmFurn && regexFurn !== llmFurn) {
    // Only flag when both are non-null and disagree
    conflicts.push({ field: 'furnished', llmVal: llmFurn, regexVal: regexFurn });
  }

  return conflicts;
}

// detectConflictsWithText — full version that has access to raw text
function detectConflictsFull(llm, regex, text) {
  const conflicts = detectConflicts(llm, regex);

  // Bedrooms + unit_type from raw text
  const cfg = regexParser.extractConfig(text);
  if (cfg.bedrooms != null) {
    if (llm.bedrooms != null && llm.bedrooms !== cfg.bedrooms) {
      conflicts.push({ field: 'bedrooms', llmVal: llm.bedrooms, regexVal: cfg.bedrooms });
    }
    if (cfg.unit_type && llm.unit_type && llm.unit_type !== cfg.unit_type) {
      conflicts.push({ field: 'unit_type', llmVal: llm.unit_type, regexVal: cfg.unit_type });
    }
    // LLM missed bedrooms entirely
    if (!llm.bedrooms) {
      conflicts.push({ field: 'bedrooms', llmVal: null, regexVal: cfg.bedrooms });
    }
  }

  return conflicts;
}

// ─── Final merge ─────────────────────────────────────────────────────────────
// Regex wins for structured/deterministic fields.
// LLM wins for free-form fields (intent context, amenities list, etc.).
// The re-queried LLM result (if any) overrides the initial one.

function merge(llm, llm2, regex, text) {
  // Use re-queried LLM as primary if it exists, else fall back to first LLM
  const primary = llm2 || llm;
  if (!primary) return null;

  const out = { ...primary };

  // ── Location: regex always wins when it found something concrete ──────────
  const regexLoc = regex?.location || null;
  if (regexLoc) {
    out.community = regexLoc;
    out.area_text = regexLoc;
    out.location  = regexLoc;
  } else if (!out.community) {
    // Try first-line extraction as last resort
    const firstLine = regexParser.extractFirstLineLocation(text);
    if (firstLine) {
      out.community = firstLine;
      out.area_text = firstLine;
      out.location  = firstLine;
    }
  }

  // ── Price: regex wins when LLM rounded or hallucinated ───────────────────
  if (regex?.price != null) {
    const rp = parseFloat(regex.price);
    const lp = parseFloat(out.price);
    if (!isNaN(rp)) {
      if (isNaN(lp)) {
        out.price = rp;
      } else {
        // If values differ by >25%, prefer regex (it's deterministic)
        const ratio = Math.max(rp, lp) / Math.min(rp, lp);
        if (ratio > 1.25) out.price = rp;
      }
    }
    // Currency from regex takes priority when LLM is uncertain
    if (regex.currency && !out.currency) out.currency = regex.currency;
  }

  // ── Bedrooms + unit_type: regex regex regex ───────────────────────────────
  const cfg = regexParser.extractConfig(text);
  if (cfg.bedrooms != null) {
    out.bedrooms  = cfg.bedrooms;
    out.unit_type = cfg.unit_type || out.unit_type || null;
  }

  // ── Furnished: regex is more precise (explicit canonical mapping) ─────────
  if (regex?.furnished) out.furnished = regex.furnished;

  // ── Amenities: union of both ──────────────────────────────────────────────
  const amenLlm   = Array.isArray(out.amenities)     ? out.amenities     : [];
  const amenRegex = Array.isArray(regex?.amenities)   ? regex.amenities   : [];
  out.amenities = [...new Set([...amenLlm, ...amenRegex])];

  // ── Parking: OR (either parser finding it counts) ─────────────────────────
  out.parking = out.parking || regex?.parking || 0;

  // ── Confidence boost when regex and LLM agree on key fields ──────────────
  let agreements = 0;
  const checks = ['price', 'bedrooms', 'community'];
  for (const f of checks) {
    if (out[f] != null && regex?.[f === 'community' ? 'location' : f] != null) {
      if (String(out[f]).toLowerCase() === String(regex[f === 'community' ? 'location' : f]).toLowerCase())
        agreements++;
    }
  }
  const baseConf = parseFloat(out.confidence) || 0;
  out.confidence = Math.min(1.0, baseConf + agreements * 0.05);

  out.extracted_by = llm2
    ? `multi:groq-recheck+regex`
    : `multi:groq+regex`;

  return out;
}

// ─── Gemini reconcile (preserved from original) ───────────────────────────────
const CONSENSUS_FIELDS = [
  'intent', 'property_type', 'unit_type', 'bedrooms', 'bathrooms',
  'price', 'currency', 'rent_period', 'community', 'area_text',
  'furnished', 'vacant', 'parking',
];

function reconcileGemini(groq, gemini) {
  if (!groq && !gemini) return null;
  if (!groq)   return { ...gemini, extracted_by: 'gemini-only' };
  if (!gemini) return { ...groq };

  const out = { ...groq };
  let agreements = 0;

  for (const field of CONSENSUS_FIELDS) {
    const g = groq[field]   ?? null;
    const m = gemini[field] ?? null;
    if (JSON.stringify(g) === JSON.stringify(m)) { agreements++; continue; }
    if (g === null && m !== null) { out[field] = m; continue; }
    if (g !== null && m === null) continue; // keep groq
    // Both non-null and different — prefer non-null, or Groq as tiebreaker
    out[field] = g ?? m;
  }

  const amenG = Array.isArray(groq.amenities)   ? groq.amenities   : [];
  const amenM = Array.isArray(gemini.amenities) ? gemini.amenities : [];
  out.amenities = [...new Set([...amenG, ...amenM])];

  const agreementRatio = CONSENSUS_FIELDS.length > 0 ? agreements / CONSENSUS_FIELDS.length : 0.5;
  const baseConf = Math.max(groq.confidence ?? 0, gemini.confidence ?? 0);
  out.confidence = Math.min(1.0, baseConf * (0.7 + 0.6 * agreementRatio));
  out.is_listing = !!(groq.is_listing || gemini.is_listing);
  out.extracted_by = `dual:groq+gemini (agreement=${Math.round(agreementRatio * 100)}%)`;

  return out;
}

// ─── Public interface ─────────────────────────────────────────────────────────

class DualParser {
  constructor() {
    this.enabled       = groqParser.enabled;
    this.geminiEnabled = geminiParser.enabled;
  }

  async parse(text, senderName) {
    if (!text || text.length < 4) return this._empty(senderName);

    // ── Stage 1: LLM + Regex in parallel ─────────────────────────────────────
    const [llmRaw, geminiRaw, regexResult] = await Promise.all([
      this.enabled
        ? groqParser.parse(text, senderName).catch(() => null)
        : Promise.resolve(null),
      this.geminiEnabled
        ? geminiParser.parse(text).catch(() => null)
        : Promise.resolve(null),
      // Regex is synchronous — wrap in a resolved promise for Promise.all
      Promise.resolve(regexParser.parse(text, senderName)),
    ]);

    // Normalise Gemini output through LlmParser's normaliser
    const geminiResult = geminiRaw
      ? groqParser._normaliseLlmOutput(geminiRaw, senderName)
      : null;

    // When both LLMs are available, reconcile them first (preserves Gemini quality)
    let llmResult = llmRaw;
    if (llmRaw && geminiResult) {
      llmResult = reconcileGemini(llmRaw, geminiResult);
    }

    // ── Stage 2: Detect conflicts between (reconciled) LLM and Regex ─────────
    const conflicts = detectConflictsFull(llmResult, regexResult, text);

    // ── Stage 3: Re-query LLM with regex data as dynamic hints ───────────────
    let llmResult2 = null;
    if (conflicts.length > 0 && this.enabled) {
      llmResult2 = await groqParser.parseWithContext(text, senderName, conflicts).catch(() => null);
    }

    // ── Stage 4: Final merge ──────────────────────────────────────────────────
    const final = merge(llmResult, llmResult2, regexResult, text);
    if (!final) return this._empty(senderName);

    // Attach meta fields
    final.agent_name  = llmResult?.agent_name  || senderName || null;
    final.description = llmResult?.description
      || text.slice(0, 120).replace(/\s+/g, ' ').trim();

    if (conflicts.length > 0) {
      console.log(
        `[multi-parser] ${conflicts.length} conflict(s) in "${text.slice(0,60).replace(/\n/g,' ')}":`,
        conflicts.map(c => `${c.field}(llm="${c.llmVal}" → regex="${c.regexVal}")`).join(', ')
      );
    }

    return final;
  }

  _empty(senderName) {
    return {
      is_listing: false, intent: null, property_type: null, unit_type: null,
      bedrooms: null, bathrooms: null, area_sqft: null, area_sqm: null,
      price: null, currency: null, rent_period: null,
      community: null, area_text: null, location: null,
      furnished: null, amenities: [], vacant: null,
      agent_phone: null, agent_name: senderName, confidence: 0,
      parking: 0, description: '', extracted_by: 'multi:empty',
    };
  }
}

module.exports = { DualParser };
