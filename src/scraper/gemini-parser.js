// Gemini 2.0 Flash parser — mirrors the Groq/Llama parser interface so the
// dual-parser can call both and reconcile.  Uses the same SYSTEM_PROMPT from
// llm-parser.js so both models operate on an identical schema.
//
// Rate limits (free tier): 15 RPM, 1M tokens/day
// Each listing ≈ 250 tokens → supports ~4000 listings/day on free tier alone.

require('dotenv').config();
const { SYSTEM_PROMPT } = require('./llm-parser');

const GEMINI_URL_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

// 12 RPM — a little below the 15 RPM free-tier limit for safety
const RATE_LIMIT_PER_MIN = 12;
const _callTimestamps = [];

async function _waitForRateLimit() {
  const now  = Date.now();
  const cutoff = now - 60_000;
  while (_callTimestamps.length && _callTimestamps[0] < cutoff) _callTimestamps.shift();
  if (_callTimestamps.length >= RATE_LIMIT_PER_MIN) {
    const wait = _callTimestamps[0] + 60_000 - now + 250;
    await new Promise(r => setTimeout(r, wait));
    return _waitForRateLimit();
  }
  _callTimestamps.push(now);
}

class GeminiParser {
  constructor(opts = {}) {
    this.apiKey  = opts.apiKey  || process.env.GEMINI_API_KEY || '';
    this.model   = opts.model   || process.env.GEMINI_MODEL   || 'gemini-2.0-flash';
    this.enabled = !!this.apiKey;
    // Lightweight in-process cache (same djb2 key as LlmParser)
    this._cache  = new Map();
    this._cacheLimit = 5000;
  }

  _cacheKey(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
    return (h >>> 0) ^ 0xDEAD; // XOR so Groq + Gemini keys never collide in shared cache
  }

  async parse(text) {
    if (!text || text.length < 4 || !this.enabled) return null;

    const ck = this._cacheKey(text);
    if (this._cache.has(ck)) return this._cache.get(ck);

    try {
      await _waitForRateLimit();
      const result = await this._callGemini(text);

      if (this._cache.size >= this._cacheLimit) {
        const first = this._cache.keys().next().value;
        this._cache.delete(first);
      }
      this._cache.set(ck, result);
      return result;
    } catch (err) {
      const isRate = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED');
      if (!isRate) console.warn('[gemini-parser] call failed:', err.message?.slice(0, 200));
      return null;   // null = let the dual-parser fall back to Groq-only
    }
  }

  async _callGemini(text) {
    const url = `${GEMINI_URL_BASE}/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [{
        parts: [{ text: text.slice(0, 4000) }],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    };

    // 30s hard timeout so a hung Gemini call never blocks the worker
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let json;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
      }

      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('Gemini returned no content');

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Gemini returned non-JSON');
      parsed = JSON.parse(m[0]);
    }

    return parsed;
  }
}

module.exports = { GeminiParser };
