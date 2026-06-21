import cron from 'node-cron';
import { syncConnection } from './routes/connections.js';
import { getDb } from './db.js';
import { canSyncConnection, MAX_SYNCS_PER_DAY } from './sync-tracker.js';

const MIN_INTERVAL_HOURS = 1; // 1 hour minimum between scheduled syncs
const DEFAULT_INTERVAL_HOURS = 2;

let scheduledTask = null;

export function initScheduler() {
  // Run every 15 minutes to check each user's preferred interval
  // (lightweight: only does work if at least one connection is due)
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule('*/15 * * * *', async () => {
    const db = getDb();
    const connections = db.prepare(`
      SELECT c.*, COALESCE(us.sync_interval_hours, 2) as interval_hours
      FROM connections c
      LEFT JOIN user_settings us ON us.user_id = c.user_id
      WHERE c.user_id IS NOT NULL
    `).all();

    for (const conn of connections) {
      try {
        // Skip if rate limit reached
        const check = canSyncConnection(conn.id);
        if (!check.allowed) {
          continue;
        }

        // Skip if not yet time for next scheduled sync
        const intervalHours = Math.max(MIN_INTERVAL_HOURS, conn.interval_hours || DEFAULT_INTERVAL_HOURS);
        if (conn.last_sync_at) {
          const lastSync = new Date(conn.last_sync_at);
          const dueAt = new Date(lastSync.getTime() + intervalHours * 60 * 60 * 1000);
          if (Date.now() < dueAt.getTime()) {
            continue;
          }
        }

        await syncConnection(conn.id, conn.user_id, 'scheduled');
        // 2-second delay between syncs
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error(`Scheduled sync failed for connection ${conn.id}:`, err.message);
      }
    }
  });

  console.log(`Scheduler initialized: checks every 15 min, per-user intervals (default ${DEFAULT_INTERVAL_HOURS}h, min ${MIN_INTERVAL_HOURS}h, max ${MAX_SYNCS_PER_DAY}/day)`);
}
