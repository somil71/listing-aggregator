// Ops tool: re-derive `listings` from the immutable `raw_messages` source after
// the parser / normalization logic improves — WITHOUT hand-written DB scripts.
//
// `raw_messages` is the source of truth; `listings` is a derived cache. When the
// extraction code changes, run this to bring existing rows up to the new logic.
//
//   node src/ops/reprocess.js [filters] [mode] [--dry-run]
//
// Modes:
//   (default)  normalization-only — re-runs ONLY the deterministic regex pass
//              (location validation/repair, price/furnished/amenity backfill,
//              group_name refresh) directly against existing listings. No LLM
//              call, no API cost, no queue. Use this for the common case: a
//              regex/normalization fix. Idempotent.
//   --full     re-enqueue the matching raw_messages so the worker re-runs the
//              full LLM pipeline + normalize + UPSERT. Costs LLM quota / time.
//              Use only when the LLM prompt or model changed.
//
// Filters (combine freely; with none you MUST pass --all as a guard):
//   --user <uuid>        only this user's rows
//   --since <ISO date>   ts_listed >= date  (e.g. --since 2026-05-01)
//   --until <ISO date>   ts_listed <  date
//   --limit <n>          cap the number of rows
//   --all                required when no other filter is given
//   --dry-run            report what WOULD change, write nothing

require('dotenv').config();
const pg = require('../db/postgres/pool');
const queue = require('../queue/upstashClient');
const { MessageParser } = require('../scraper/message-parser');
const { PARSE_QUEUE } = require('../db/dualWrite');

const regexParser = new MessageParser();

function parseArgs(argv) {
  const a = { mode: 'normalize', dryRun: false, all: false, yes: false, limit: null,
              user: null, since: null, until: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--full') a.mode = 'full';
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--all') a.all = true;
    else if (t === '--yes') a.yes = true;
    else if (t === '--user') a.user = argv[++i];
    else if (t === '--since') a.since = argv[++i];
    else if (t === '--until') a.until = argv[++i];
    else if (t === '--limit') a.limit = parseInt(argv[++i], 10);
    else { console.error(`unknown arg: ${t}`); process.exit(2); }
  }
  return a;
}

// Build a WHERE clause + params for the listing/raw filters.
function buildWhere(a, alias = 'l') {
  const where = [];
  const params = [];
  if (a.user)  { params.push(a.user);  where.push(`${alias}.user_id = $${params.length}`); }
  if (a.since) { params.push(a.since); where.push(`${alias}.ts_listed >= $${params.length}`); }
  if (a.until) { params.push(a.until); where.push(`${alias}.ts_listed <  $${params.length}`); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function changed(before, after) {
  if (Array.isArray(before) || Array.isArray(after)) {
    const norm = v => JSON.stringify([...(v || [])].sort());
    return norm(before) !== norm(after);
  }
  // Numeric-aware: Postgres returns NUMERIC as a string ("22500.00"), so a plain
  // string compare against the JS number 22500 would falsely flag a change.
  if (before != null && after != null) {
    const bn = Number(before), an = Number(after);
    if (!isNaN(bn) && !isNaN(an)) return bn !== an;
  }
  const s = v => (v == null ? null : String(v));
  return s(before) !== s(after);
}

async function runNormalize(a) {
  const { sql, params } = buildWhere(a, 'l');
  const limit = a.limit ? ` LIMIT ${a.limit}` : '';
  const rows = await pg.dbAll(
    `SELECT l.id, l.price, l.currency, l.furnished, l.amenities,
            l.area_text, l.community, l.group_name,
            l.bedrooms, l.area_sqft, l.agent_phone, l.agent_name, l.confidence,
            l.intent, l.rent_period, l.quarantine_reason,
            r.text AS raw_text,
            mg.group_name AS mg_group_name
       FROM listings l
       JOIN raw_messages r ON r.id = l.raw_message_id
       LEFT JOIN monitored_groups mg
         ON mg.user_id = l.user_id AND mg.wa_group_id = l.wa_group_id
       ${sql}
       ORDER BY l.ts_listed DESC${limit}`,
    params
  );

  let scanned = 0, updated = 0;
  const tally = { price: 0, furnished: 0, amenities: 0, location: 0, group_name: 0, confidence: 0, quarantine_reason: 0 };

  for (const row of rows) {
    scanned++;
    const text = row.raw_text || '';
    const parsed = {
      price: row.price != null ? Number(row.price) : null,
      currency: row.currency,
      furnished: row.furnished,
      amenities: row.amenities || [],
      community: row.community,
      area_text: row.area_text,
      location: row.community || row.area_text || null,
      // Fields below feed calculateConfidence inside normalize() — load them so
      // the recomputed confidence matches what the live worker would produce.
      bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
      area_sqft: row.area_sqft,
      agent_phone: row.agent_phone,
      agent_name: row.agent_name,
      parking: regexParser.hasParking(text),
      confidence: row.confidence != null ? Number(row.confidence) : null,
      // intent + rent_period drive the rent-ceiling sanity check in normalize()
      // — without them an existing bad rent row couldn't be re-quarantined here.
      intent: row.intent,
      rent_period: row.rent_period,
      quarantine_reason: row.quarantine_reason,
    };
    regexParser.normalize(parsed, text);

    // Refresh stale group_name (null or raw @g.us id) from monitored_groups.
    let groupName = row.group_name;
    if ((!groupName || /@g\.us$/i.test(groupName)) && row.mg_group_name) {
      groupName = row.mg_group_name;
    }

    const diffs = {
      price: changed(row.price, parsed.price),
      furnished: changed(row.furnished, parsed.furnished),
      amenities: changed(row.amenities, parsed.amenities),
      location: changed(row.community, parsed.community) || changed(row.area_text, parsed.area_text),
      group_name: changed(row.group_name, groupName),
      confidence: changed(row.confidence, parsed.confidence),
      quarantine_reason: changed(row.quarantine_reason, parsed.quarantine_reason),
    };
    const anyChange = Object.values(diffs).some(Boolean);
    if (!anyChange) continue;
    for (const k of Object.keys(tally)) if (diffs[k]) tally[k]++;
    updated++;

    if (a.dryRun) continue;
    await pg.query(
      `UPDATE listings
          SET price = $2, currency = $3, furnished = $4, amenities = $5,
              area_text = $6, community = $7, group_name = $8,
              confidence = $9, quarantine_reason = $10, updated_at = NOW()
        WHERE id = $1`,
      [row.id,
       parsed.price ?? null,
       parsed.currency ?? null,
       parsed.furnished || null,
       parsed.amenities || [],
       parsed.area_text || null,
       parsed.community || null,
       groupName || null,
       parsed.confidence ?? 0,
       parsed.quarantine_reason ?? null]
    );
  }

  console.log(`[reprocess:normalize]${a.dryRun ? ' DRY-RUN' : ''} scanned=${scanned} changed=${updated}`);
  console.log(`  field changes:`, JSON.stringify(tally));
}

async function runFull(a) {
  const { sql, params } = buildWhere(a, 'r');
  const limit = a.limit ? ` LIMIT ${a.limit}` : '';
  const rows = await pg.dbAll(
    `SELECT r.id AS raw_id, r.text, r.sender_name, r.wa_group_id, r.ts_received,
            mg.group_name
       FROM raw_messages r
       LEFT JOIN monitored_groups mg
         ON mg.user_id = r.user_id AND mg.wa_group_id = r.wa_group_id
       ${sql.replace(/r\.ts_listed/g, 'r.ts_received')}
       ORDER BY r.ts_received DESC${limit}`,
    params
  );

  if (a.dryRun) {
    console.log(`[reprocess:full] DRY-RUN would re-enqueue ${rows.length} raw_messages to ${PARSE_QUEUE}`);
    return;
  }
  // --full re-runs the paid LLM pipeline per message. Guard large runs: require
  // an explicit --yes when the job is unbounded (no --limit) and would hit the
  // LLM enough times to matter. ~1 message/sec through the worker + provider
  // rate limits mean this is also slow, not just costly.
  if (!a.limit && rows.length > 25 && !a.yes) {
    console.error(`[reprocess:full] Refusing to re-enqueue ${rows.length} messages through the LLM without --yes.`);
    console.error(`  This calls Groq+Gemini once per message (cost + rate limits) and takes ~${Math.ceil(rows.length / 60)} min.`);
    console.error(`  Re-run with --yes to confirm, add --limit N to cap, or drop --full to do a free regex-only pass.`);
    process.exit(2);
  }
  let enq = 0;
  for (const r of rows) {
    const ok = await queue.enqueue(PARSE_QUEUE, {
      raw_id: r.raw_id, text: r.text, sender_name: r.sender_name,
      wa_group_id: r.wa_group_id, group_name: r.group_name, ts_received: r.ts_received,
    });
    if (ok) enq++;
  }
  console.log(`[reprocess:full] re-enqueued ${enq}/${rows.length} raw_messages — worker will re-derive listings`);
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  if (!a.all && !a.user && !a.since && !a.until && !a.limit) {
    console.error('Refusing to reprocess the entire table without an explicit filter.');
    console.error('Pass --all to confirm, or narrow with --user / --since / --until / --limit.');
    process.exit(2);
  }
  console.log(`[reprocess] mode=${a.mode} dryRun=${a.dryRun} ` +
              `filters={user:${a.user || '-'}, since:${a.since || '-'}, until:${a.until || '-'}, limit:${a.limit || '-'}}`);
  if (a.mode === 'full') await runFull(a);
  else await runNormalize(a);
  await pg.close().catch(() => {});
})().catch(e => { console.error('[reprocess] fatal:', e); process.exit(1); });
