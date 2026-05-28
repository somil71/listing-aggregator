/**
 * Master Audit Runner — runs all test suites and generates a report.
 * Usage:
 *   node tests/run_audit.js              (server must already be running)
 *   TOKEN=<clerk_jwt> node tests/run_audit.js
 *
 * Individual suites:
 *   node tests/smoke.js
 *   node tests/endpoints.js
 *   node tests/security.js
 *   node tests/db_integrity.js
 *   node tests/performance.js
 *   node tests/bulk_insert.js   (standalone, no server needed)
 *   node tests/bulk_parse.js    (standalone, run after bulk_insert)
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
const reportFile = path.join(REPORTS_DIR, `AUDIT_${dateStr}_${timeStr}.md`);

const SUITES = [
  { name: 'Smoke Tests',        file: 'smoke.js',        section: '1' },
  { name: 'Endpoint Tests',     file: 'endpoints.js',    section: '2' },
  { name: 'Security Audit',     file: 'security.js',     section: '5' },
  { name: 'DB Integrity',       file: 'db_integrity.js', section: '7' },
  { name: 'Performance Tests',  file: 'performance.js',  section: '6' },
];

function runSuite(suite) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Running: ${suite.name}`);
  console.log('─'.repeat(70));

  const env = { ...process.env };
  const result = spawnSync('node', [path.join(__dirname, suite.file)], {
    env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 120_000,
  });

  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(output);

  const exitCode = result.status ?? 1;
  const passMatch = output.match(/Result: (\d+) passed, (\d+) failed/);
  const p = passMatch ? parseInt(passMatch[1]) : 0;
  const f = passMatch ? parseInt(passMatch[2]) : (exitCode !== 0 ? 1 : 0);

  return { name: suite.name, section: suite.section, passed: p, failed: f, output, exitCode };
}

function buildReport(results) {
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const criticalFailed = results.filter(r => r.failed > 0).map(r => r.name);
  const overallStatus = totalFailed === 0 ? 'PASSED' : 'FAILED';

  let md = `# Property Digest — Audit Report\n`;
  md += `**Date:** ${now.toLocaleString()}\n`;
  md += `**Node version:** ${process.version}\n`;
  md += `**Platform:** ${process.platform}\n\n`;
  md += `---\n\n`;

  md += `## Executive Summary\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| **Overall Status** | ${overallStatus === 'PASSED' ? '✅ PASSED' : '❌ FAILED'} |\n`;
  md += `| **Tests Passed** | ${totalPassed} |\n`;
  md += `| **Tests Failed** | ${totalFailed} |\n`;
  md += `| **Suites with failures** | ${criticalFailed.length === 0 ? 'None' : criticalFailed.join(', ')} |\n\n`;

  md += `## Suite Results\n\n`;
  md += `| Suite | Section | Passed | Failed | Status |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const r of results) {
    const status = r.failed === 0 ? '✅' : '❌';
    md += `| ${r.name} | §${r.section} | ${r.passed} | ${r.failed} | ${status} |\n`;
  }

  md += `\n---\n\n## Detailed Output\n\n`;
  for (const r of results) {
    md += `### ${r.name}\n\n`;
    md += `\`\`\`\n${r.output.substring(0, 4000)}\n\`\`\`\n\n`;
  }

  md += `---\n\n`;
  md += `## What Was Tested\n\n`;
  md += `### Section 1 — Smoke Tests\n`;
  md += `- Server health endpoint reachability and response structure\n`;
  md += `- Database connectivity via /health endpoint\n`;
  md += `- Auth enforcement (all protected routes return 401 without a token)\n`;
  md += `- Static SPA file serving\n\n`;
  md += `### Section 2 — Endpoint Tests\n`;
  md += `- All GET/POST endpoints for listings, search, agents, groups, WhatsApp, digests\n`;
  md += `- Input validation (invalid prices, dates, empty queries)\n`;
  md += `- 404 error shape for non-existent routes\n\n`;
  md += `### Section 5 — Security Audit\n`;
  md += `- SQL injection prevention (parameterized queries, 4 payloads)\n`;
  md += `- XSS: script tags in search input not reflected unescaped\n`;
  md += `- Auth enforcement on all 10 protected routes\n`;
  md += `- Invalid token rejection\n`;
  md += `- .env file not served by Express\n`;
  md += `- No secrets in health endpoint response\n\n`;
  md += `### Section 6 — Performance Tests\n`;
  md += `- Response time benchmarks (7 endpoints, median of 3 runs)\n`;
  md += `- 100 concurrent requests to /health (20 at a time)\n`;
  md += `- P50/P95/P99 latency measurement\n`;
  md += `- Memory growth check (<50 MB over 50 requests)\n\n`;
  md += `### Section 7 — Database Integrity\n`;
  md += `- All required tables exist\n`;
  md += `- All 8 required indexes present\n`;
  md += `- UNIQUE constraints on whatsapp_sessions and selected_groups\n`;
  md += `- INSERT OR IGNORE idempotency on raw_messages\n`;
  md += `- Transaction rollback behaviour\n`;
  md += `- EXPLAIN QUERY PLAN confirms indexes are used\n\n`;

  md += `---\n\n`;
  md += `## Bulk Tests (run separately)\n\n`;
  md += `The following tests must be run manually (they mutate the database):\n\n`;
  md += `\`\`\`bash\n`;
  md += `# Insert 50,000 test messages (limit: 30s)\n`;
  md += `node tests/bulk_insert.js\n\n`;
  md += `# Parse those messages into listings (limit: 60s, expect >70% success rate)\n`;
  md += `node tests/bulk_parse.js\n`;
  md += `\`\`\`\n\n`;
  md += `These are kept separate to avoid corrupting your real listing database during automated runs.\n\n`;

  md += `---\n\n`;
  md += `## How to Run\n\n`;
  md += `\`\`\`bash\n`;
  md += `# Start server (in a separate terminal)\n`;
  md += `npm start\n\n`;
  md += `# Run full audit\n`;
  md += `node tests/run_audit.js\n\n`;
  md += `# Run with auth token (enables authenticated endpoint testing)\n`;
  md += `TOKEN=<clerk_jwt> node tests/run_audit.js\n\n`;
  md += `# Run individual suites\n`;
  md += `node tests/smoke.js\n`;
  md += `node tests/security.js\n`;
  md += `node tests/db_integrity.js\n`;
  md += `node tests/performance.js\n`;
  md += `node tests/endpoints.js\n`;
  md += `\`\`\`\n\n`;

  md += `---\n\n*Generated by Property Digest audit runner — ${now.toISOString()}*\n`;

  return md;
}

async function main() {
  console.log('\n🧪 Property Digest — Full Audit');
  console.log('='.repeat(70));
  console.log(`Date: ${now.toLocaleString()}`);
  if (process.env.TOKEN) console.log('Mode: Authenticated (TOKEN provided)');
  else console.log('Mode: Unauthenticated (protected routes tested for 401)');

  const results = [];
  for (const suite of SUITES) {
    results.push(runSuite(suite));
  }

  const report = buildReport(results);
  fs.writeFileSync(reportFile, report, 'utf8');

  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);

  console.log('\n' + '='.repeat(70));
  console.log(`\n📊 AUDIT COMPLETE`);
  console.log(`   Total: ${totalPassed + totalFailed} tests`);
  console.log(`   Passed: ${totalPassed}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`\n📄 Report saved to: reports/AUDIT_${dateStr}_${timeStr}.md`);
  console.log(totalFailed === 0 ? '\n✅ ALL SUITES PASSED — SYSTEM IS PRODUCTION READY' : `\n❌ ${totalFailed} test(s) failed — review report`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
