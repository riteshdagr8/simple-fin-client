import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { getDb } from './db.js';
import { processReceiptFile } from './receipt-processor.js';

const RECEIPTS_DIR = path.join(process.cwd(), 'data', 'receipts');
const watchers = new Map();

export function initReceiptWatchers() {
  const db = getDb();
  const users = db.prepare('SELECT id FROM users').all();

  for (const user of users) {
    startWatchingUser(user.id);
  }

  console.log(`[RECEIPT] Initialized watchers for ${users.length} users`);
}

function startWatchingUser(userId) {
  if (watchers.has(userId)) return;

  const userDir = path.join(RECEIPTS_DIR, userId.toString());

  // Ensure directory exists
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  const watcher = chokidar.watch(userDir, {
    persistent: true,
    // Process files that exist when the watcher starts (covers the case
    // where a user drops a file while the server is down). The DB dedup
    // check below prevents reprocessing files we already know about.
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('add', async (filePath) => {
    try {
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase();

      // Only process image and PDF files
      if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.pdf'].includes(ext)) {
        return;
      }

      const db = getDb();

      // Check if receipt already exists
      const existing = db.prepare('SELECT id FROM receipts WHERE filename = ? AND user_id = ?').get(filename, userId);
      if (existing) {
        return;
      }

      // Insert receipt record
      const result = db.prepare(`
        INSERT INTO receipts (user_id, filename, original_name, file_type, ocr_status)
        VALUES (?, ?, ?, ?, 'pending')
      `).run(userId, filename, filename, ext.slice(1));

      const receiptId = result.lastInsertRowid;
      console.log(`[RECEIPT] New file detected: ${filename} (user ${userId}, receipt ${receiptId})`);

      // Process asynchronously
      processReceiptFile(userId, receiptId, filePath).catch(err => {
        console.error(`[RECEIPT] Processing failed for ${filename}:`, err);
      });

    } catch (err) {
      console.error('[RECEIPT] Error handling new file:', err);
    }
  });

  watcher.on('error', (error) => {
    console.error(`[RECEIPT] Watcher error for user ${userId}:`, error);
  });

  watchers.set(userId, watcher);
}

export function stopAllWatchers() {
  for (const [userId, watcher] of watchers) {
    watcher.close();
  }
  watchers.clear();
  console.log('[RECEIPT] All watchers stopped');
}
