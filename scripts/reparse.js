require('dotenv').config();
const pg = require('../src/db/postgres/pool');
const queue = require('../src/queue/upstashClient');
const PARSE_QUEUE = 'parse:listings';

async function main() {
  // Get all users
  const users = await pg.query("SELECT id, clerk_user_id FROM users");
  console.log('Users:', users.rows.length);

  for (const user of users.rows) {
    // Delete all listings for this user
    const del = await pg.query("DELETE FROM listings WHERE user_id = $1", [user.id]);
    console.log(`User ${user.clerk_user_id}: deleted ${del.rowCount} listings`);

    // Re-queue all raw_messages
    const msgs = await pg.query(
      `SELECT r.id, r.text, r.sender_name, r.wa_group_id, r.ts_received, mg.group_name
         FROM raw_messages r
         LEFT JOIN monitored_groups mg ON mg.user_id = r.user_id AND mg.wa_group_id = r.wa_group_id
        WHERE r.user_id = $1
        ORDER BY r.ts_received DESC`,
      [user.id]
    );

    let requeued = 0;
    for (const row of msgs.rows) {
      try {
        await queue.enqueue(PARSE_QUEUE, {
          raw_id: row.id,
          text: row.text,
          sender_name: row.sender_name,
          wa_group_id: row.wa_group_id,
          group_name: row.group_name,
          ts_received: row.ts_received,
        });
        requeued++;
      } catch (e) {
        console.warn('enqueue failed:', e.message);
      }
    }
    console.log(`User ${user.clerk_user_id}: re-queued ${requeued} messages`);
  }

  await pg.close();
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
