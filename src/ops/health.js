// Ops tool: one-command health snapshot of the ingestion → parse → listings
// pipeline. This is how you NOTICE breakage without a user reporting it.
//
//   node src/ops/health.js [--user <uuid>]
//
// Surfaces the failure modes this pipeline actually hits:
//   - ingestion stalled        → newest raw_message is hours old (the "no data
//                                 since the 28th" class of incident)
//   - parse backlog growing    → worker down / queue not draining
//   - dead-lettered jobs       → messages that exhausted retries (need a look)
//   - extraction quality drop  → price/location coverage or confidence falling
//
// Exit code is non-zero when something looks wrong, so it can be wired into a
// cron / uptime check later.

require('dotenv').config();
const pg = require('../db/postgres/pool');
const queue = require('../queue/upstashClient');
const { PARSE_QUEUE } = require('../db/dualWrite');

// Thresholds — tune as the product grows.
const STALE_INGEST_MIN = 120;   // newest raw_message older than this ⇒ warn
const BACKLOG_WARN      = 100;   // queued parse jobs above this ⇒ warn
const COVERAGE_WARN     = 0.5;   // <50% of listings with price/location ⇒ warn

function userFilter(user, alias) {
  return user ? { sql: `WHERE ${alias}.user_id = $1`, params: [user] } : { sql: '', params: [] };
}

(async () => {
  const user = process.argv.includes('--user')
    ? process.argv[process.argv.indexOf('--user') + 1] : null;
  const warnings = [];

  // 1. Ingestion freshness.
  const f = userFilter(user, 'r');
  const fresh = await pg.dbGet(
    `SELECT MAX(ts_received) AS newest, COUNT(*) AS total FROM raw_messages r ${f.sql}`, f.params);
  const ageMin = fresh.newest ? Math.round((Date.now() - new Date(fresh.newest).getTime()) / 60000) : null;
  console.log(`ingestion : ${fresh.total} raw_messages | newest ${fresh.newest || 'none'} (${ageMin == null ? 'n/a' : ageMin + ' min ago'})`);
  if (ageMin != null && ageMin > STALE_INGEST_MIN) warnings.push(`ingestion stalled: no new message in ${ageMin} min`);

  // 2. Parse queue + job states.
  let backlog = 0;
  try { backlog = await queue.queueLength(PARSE_QUEUE); } catch (_) {}
  const jobs = await pg.dbAll(`SELECT status, COUNT(*) AS n FROM parse_jobs GROUP BY status`);
  const byStatus = Object.fromEntries(jobs.map(j => [j.status, Number(j.n)]));
  console.log(`parsing   : queue backlog ${backlog} | jobs ${JSON.stringify(byStatus)}`);
  if (backlog > BACKLOG_WARN) warnings.push(`parse backlog ${backlog} (worker down or overwhelmed?)`);
  if (byStatus.dead)   warnings.push(`${byStatus.dead} dead-lettered job(s) — inspect parse_jobs.dead_reason`);
  if (byStatus.failed) warnings.push(`${byStatus.failed} failed job(s) currently retrying`);

  // 3. Extraction quality.
  const fl = userFilter(user, 'l');
  const cov = await pg.dbGet(
    `SELECT COUNT(*) total,
            COUNT(price) has_price,
            COUNT(*) FILTER (WHERE community IS NOT NULL OR area_text IS NOT NULL) has_loc,
            COUNT(*) FILTER (WHERE amenities IS NOT NULL AND array_length(amenities,1) > 0) has_amen,
            COUNT(*) FILTER (WHERE confidence >= 0.7) high_conf,
            COUNT(*) FILTER (WHERE confidence < 0.3 OR confidence IS NULL) low_conf
       FROM listings l ${fl.sql}`, fl.params);
  const total = Number(cov.total) || 0;
  const pct = n => total ? (Number(n) / total) : 1;
  const f1 = x => (x * 100).toFixed(0) + '%';
  console.log(`listings  : ${total} total | price ${f1(pct(cov.has_price))} | location ${f1(pct(cov.has_loc))} | amenities ${f1(pct(cov.has_amen))}`);
  console.log(`confidence: high ${f1(pct(cov.high_conf))} | low ${f1(pct(cov.low_conf))}`);
  if (total > 10 && pct(cov.has_price) < COVERAGE_WARN) warnings.push(`price coverage ${f1(pct(cov.has_price))} below ${f1(COVERAGE_WARN)}`);
  if (total > 10 && pct(cov.has_loc)   < COVERAGE_WARN) warnings.push(`location coverage ${f1(pct(cov.has_loc))} below ${f1(COVERAGE_WARN)}`);

  // 4. Auto-heal signals. Two detection channels:
  //    - quarantined: rows the deterministic sanity validator caught and hid
  //      (the system working). A *spike* in the rate means the parser regressed.
  //    - user-flagged: the human channel — a flagged row is one our validators
  //      MISSED, so it always warrants a look (and a new validator rule).
  const q = await pg.dbGet(
    `SELECT COUNT(*) FILTER (WHERE quarantine_reason IS NOT NULL) quarantined,
            COUNT(*) FILTER (WHERE user_flags > 0) flagged_rows,
            COALESCE(SUM(user_flags), 0) flag_total
       FROM listings l ${fl.sql}`, fl.params);
  const reasons = await pg.dbAll(
    `SELECT split_part(quarantine_reason, ':', 1) reason, COUNT(*) n
       FROM listings l ${fl.sql ? fl.sql + ' AND' : 'WHERE'} quarantine_reason IS NOT NULL
      GROUP BY 1 ORDER BY n DESC LIMIT 5`, fl.params);
  const reasonStr = reasons.length ? reasons.map(r => `${r.reason}×${r.n}`).join(', ') : 'none';
  console.log(`autoheal  : quarantined ${q.quarantined} (${reasonStr}) | user-flagged ${q.flagged_rows} row(s) / ${q.flag_total} flags`);
  if (total > 10 && pct(q.quarantined) > 0.2) warnings.push(`quarantine rate ${f1(pct(q.quarantined))} high — parser regression?`);
  if (Number(q.flagged_rows) > 0) warnings.push(`${q.flagged_rows} user-flagged listing(s) — auto-heal missed these; add a sanity rule`);

  console.log('');
  if (warnings.length) {
    console.log(`STATUS: WARN (${warnings.length})`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  } else {
    console.log('STATUS: OK');
  }
  await pg.close().catch(() => {});
  process.exit(warnings.length ? 1 : 0);
})().catch(e => { console.error('[health] fatal:', e); process.exit(2); });
