import 'dotenv/config';
import { createApp } from './app.js';
import { initScheduler, initEmailSummaryScheduler, initReceiptCleanupScheduler, initBackupScheduler } from './scheduler.js';
import { ensureSecret, ensureSecretLength, DEFAULT_JWT_SECRET, DEFAULT_ENCRYPTION_KEY } from './boot-guard.js';

// Security: fail fast on default / missing / weak secrets
ensureSecret('JWT_SECRET', DEFAULT_JWT_SECRET);
ensureSecret('ENCRYPTION_KEY', DEFAULT_ENCRYPTION_KEY, /* allowDefault = */ false);
ensureSecretLength('JWT_SECRET', 32);
ensureSecretLength('ENCRYPTION_KEY', 32);

const app = createApp();
const PORT = process.env.PORT || 3000;

// Start server — store reference for graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`FinApp server running on http://localhost:${PORT}`);
  initScheduler();
  initEmailSummaryScheduler();
  initReceiptCleanupScheduler();
  initBackupScheduler();
  import('./receipt-watch.js').then(({ initReceiptWatchers }) => {
    initReceiptWatchers();
  });
});

// Graceful shutdown — uses dynamic import because this is an ESM module
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  console.log('[SHUTDOWN] Signal received — shutting down gracefully...');
  try {
    const { getDb } = await import('./db.js');
    try { getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { console.error('[SHUTDOWN] WAL checkpoint failed:', e.message); }
    try { getDb().close(); } catch {}
  } catch (e) {
    console.error('[SHUTDOWN] DB close failed:', e.message);
  }
  try {
    const cron = await import('node-cron');
    cron.default.getTasks().forEach(t => t.stop());
  } catch (e) {
    console.error('[SHUTDOWN] Cron stop failed:', e.message);
  }
  // Stop chokidar receipt watchers — without this the open file handles keep
  // the event loop alive and the process only exits via the forced-exit timer.
  try {
    const { stopAllWatchers } = await import('./receipt-watch.js');
    stopAllWatchers();
  } catch (e) {
    console.error('[SHUTDOWN] Receipt watcher stop failed:', e.message);
  }
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
  // Force exit if graceful close takes too long
  setTimeout(() => {
    console.warn('[SHUTDOWN] Forced exit after 10s timeout');
    process.exit(1);
  }, 10000).unref();
}
