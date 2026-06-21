import { getDb } from './db.js';

// SimpleFIN's hard limit: 24 syncs per connection per 24 hours.
// We use 24 as the cap to match the limit, with no buffer (user wanted the cap).
const MAX_SYNCS_PER_DAY = 24;
const MAX_LOOKBACK_DAYS = 90; // for first-time syncs, fetch up to 90 days of history

export function canSyncConnection(connectionId) {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM sync_log
    WHERE connection_id = ?
      AND started_at >= ?
      AND status != 'failed'
  `).get(connectionId, since);
  return { allowed: row.cnt < MAX_SYNCS_PER_DAY, count: row.cnt, limit: MAX_SYNCS_PER_DAY };
}

export function getSyncCountToday(connectionId) {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM sync_log
    WHERE connection_id = ?
      AND started_at >= ?
  `).get(connectionId, since);
  return row.cnt;
}

export function getStartDateForSync(conn) {
  // If we've synced before, go back 1 day to catch any late-arriving data.
  // If first sync, fetch MAX_LOOKBACK_DAYS to populate historical data.
  if (conn.last_sync_at) {
    const lastSync = new Date(conn.last_sync_at + 'Z');
    lastSync.setDate(lastSync.getDate() - 1);
    return Math.floor(lastSync.getTime() / 1000);
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_LOOKBACK_DAYS);
  return Math.floor(cutoff.getTime() / 1000);
}

export { MAX_SYNCS_PER_DAY, MAX_LOOKBACK_DAYS };
