require('dotenv').config();
const queue = require('../src/queue/upstashClient');
async function main() {
  if (!queue.client) { console.log('No Redis client — in-memory cache, no flush needed'); process.exit(0); }
  // Clear listing cache keys
  const keys = ['listings:*', 'scrape-stats:*'];
  // Flush keys matching pattern
  try {
    await queue.client.del(
      'listings',
      'scrape-stats',
      'groups:all',
    );
    console.log('Cache keys cleared');
  } catch(e) { console.log('Cache flush error (ok if keys dont exist):', e.message); }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
