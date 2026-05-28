// Shared phone-formatting helpers used by listing pages.
// Centralised here so a fix in one place reaches every consumer.

// Strip @c.us suffix and return the digit string — BUT reject @lid / @s.whatsapp.net
// because those are internal WhatsApp linked-device IDs, not real phone numbers.
// Only @c.us IDs map 1-to-1 to a phone number.
export function sanitizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // @lid = linked-device internal ID — NOT a phone
  if (/@lid\b/.test(raw)) return null;
  // @s.whatsapp.net = server-side internal ID — also not a real phone
  if (/@s\.whatsapp\.net\b/.test(raw)) return null;
  const stripped = raw.replace(/@\S+$/, '').replace(/[^\d+]/g, '');
  return stripped || null;
}

// Backwards-compat alias kept for older call-sites.
export const waIdToPhone = sanitizePhone;

// Format a digits-only phone string for display.
// Recognises common country codes so the result is human-readable.
export function formatPhone(digits: string | null): string {
  if (!digits) return '';
  const d = digits.replace(/\D/g, '');
  // India: +91 + 10 digits = 12 total
  if (d.length === 12 && d.startsWith('91'))
    return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  // UAE: +971 + 9 digits = 12 total
  if (d.length === 12 && d.startsWith('971'))
    return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  // Bare 10-digit Indian mobile (no country code)
  if (d.length === 10 && /^[6-9]/.test(d))
    return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  // Generic short numbers
  if (d.length <= 7) return `+${d}`;
  if (d.length <= 11) return `+${d.slice(0, d.length - 7)} ${d.slice(-7, -4)} ${d.slice(-4)}`;
  // Long number (>11 digits) — group as country(3) + groups of 3
  return `+${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
}

// Return a display name only when the string actually looks like a human name
// (has letters, is not a raw WA ID like "256903603052728@lid", is not a phone).
export function toDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/@/.test(raw)) return null;                          // WA ID ("@c.us", "@lid", etc.)
  if (/^\+?[\d\s\-().]+$/.test(raw.trim())) return null;   // phone-number-only string
  return raw.trim() || null;
}
