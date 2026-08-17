// Database backup. Takes a consistent snapshot of the live SQLite DB (via
// better-sqlite3's backup API, safe while the app is running) into a backups/
// directory with a timestamped filename, and prunes old backups.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

// Number of most-recent backups to keep; older ones are deleted.
export const BACKUP_RETENTION = Number(process.env.BACKUP_RETENTION) || 14;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Timestamp filename: finapp-YYYY-MM-DD-HHMMSS.db (safe for sorting/lexical).
function timestampName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `finapp-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.db`;
}

// Snapshot the open database to BACKUP_DIR. Returns the backup path, or null
// if the source DB is a scratch path (we only want to back up the real DB).
export async function backupDatabase(db) {
  // Only back up the production DB (repo-root finapp.db). Scratch/test DBs
  // (DB_PATH set) are throwaway and shouldn't fill the backup folder.
  const { resolveDbPath, isProductionDb } = await import('./db-guard.js');
  const target = resolveDbPath();
  if (!isProductionDb(target)) {
    console.log('[BACKUP] Skipping backup — DB_PATH is not the production database.');
    return null;
  }

  ensureDir(BACKUP_DIR);
  const dest = path.join(BACKUP_DIR, timestampName());
  try {
    await db.backup(dest);
    console.log(`[BACKUP] Created ${dest}`);
    prune(BACKUP_DIR);
    return dest;
  } catch (err) {
    console.error('[BACKUP] Failed:', err.message);
    return null;
  }
}

// Delete backups beyond the retention window. Only touches finapp-*.db files.
export function prune(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => /^finapp-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(f))
    .sort();
  const excess = files.length - BACKUP_RETENTION;
  for (let i = 0; i < excess; i++) {
    const f = path.join(dir, files[i]);
    fs.unlinkSync(f);
    console.log(`[BACKUP] Pruned ${f}`);
  }
}
