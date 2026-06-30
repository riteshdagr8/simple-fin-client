import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';
import { processReceiptFile, findMatchingTransactions, matchReceiptWithLLM } from '../receipt-processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECEIPTS_DIR = path.join(__dirname, '..', '..', 'data', 'receipts');

// Ensure receipts directory exists
if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(RECEIPTS_DIR, req.user.userId.toString());
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Only allow known-safe extensions regardless of declared mimetype
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.pdf'];
    const safeExt = allowed.includes(ext) ? ext : '.bin';
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${safeExt}`;
    cb(null, filename);
  },
});

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'application/pdf',
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Whitelist the declared mimetype (client-controlled, but rejects obvious junk)
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
    cb(null, true);
  },
});

// Verify the file's actual content matches its claimed type. The multer
// fileFilter above trusts the client-supplied mimetype, which is trivial to
// spoof — an attacker could upload an .exe with Content-Type: image/jpeg.
// We re-check the first few bytes (magic numbers) to confirm the file is
// actually what the client claims. If not, delete it and reject the upload.
const MAGIC = [
  { ext: 'pdf',  bytes: [0x25, 0x50, 0x44, 0x46] },                          // %PDF
  { ext: 'jpg',  bytes: [0xFF, 0xD8, 0xFF] },                                  // JPEG
  { ext: 'jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { ext: 'png',  bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },  // PNG
  { ext: 'gif',  bytes: [0x47, 0x49, 0x46, 0x38] },                           // GIF8
  { ext: 'bmp',  bytes: [0x42, 0x4D] },                                        // BM
  { ext: 'tif',  bytes: [0x49, 0x49, 0x2A, 0x00] },                            // TIFF (little-endian)
  { ext: 'tiff', bytes: [0x49, 0x49, 0x2A, 0x00] },
];
function verifyMagicBytes(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    for (const m of MAGIC) {
      if (m.bytes.every((b, i) => buf[i] === b)) return m.ext;
    }
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

const router = Router();

// List receipts for current user
router.get('/', (req, res) => {
  const db = getDb();
  const receipts = db.prepare(`
    SELECT r.*,
           t.amount as txn_amount,
           t.description as txn_description,
           t.posted as txn_posted
    FROM receipts r
    LEFT JOIN transactions t ON t.id = r.matched_transaction_id
    WHERE r.user_id = ?
    ORDER BY r.uploaded_at DESC
  `).all(req.user.userId);
  res.json(receipts);
});

// Get a single receipt + candidate transactions for matching
router.get('/:id', (req, res) => {
  const db = getDb();
  const receipt = db.prepare(`
    SELECT r.*, t.amount as txn_amount, t.description as txn_description, t.posted as txn_posted
    FROM receipts r
    LEFT JOIN transactions t ON t.id = r.matched_transaction_id
    WHERE r.id = ? AND r.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  // Find candidate transactions
  let candidates = [];
  if (receipt.extracted_total != null || receipt.amount != null) {
    const amount = receipt.extracted_total || receipt.amount;
    const dateFilter = receipt.extracted_date
      ? `AND t.posted >= datetime(?, '-3 days') AND t.posted <= datetime(?, '+3 days')`
      : '';

    const params = [req.user.userId, Math.abs(amount)];
    if (receipt.extracted_date) {
      params.push(receipt.extracted_date, receipt.extracted_date);
    }

    candidates = db.prepare(`
      SELECT t.id, t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ? AND ABS(t.amount) = ? ${dateFilter} AND (a.is_hidden IS NULL OR a.is_hidden = 0)
      ORDER BY t.posted DESC
      LIMIT 20
    `).all(...params);
  }

  res.json({ ...receipt, candidates });
});

// Upload a receipt
router.post('/upload', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Defense-in-depth: verify the file's actual content matches the
    // declared type. The multer fileFilter above only checks mimetype, which
    // is supplied by the client and trivially spoofable. If the bytes don't
    // match, delete the file and reject the upload.
    const detectedExt = verifyMagicBytes(req.file.path);
    if (!detectedExt) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'File contents do not match an allowed image or PDF format' });
    }

    const db = getDb();
    const { amount, description } = req.body;

    const parsedAmount = amount ? parseFloat(amount) : null;
    if (parsedAmount != null && isNaN(parsedAmount)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'amount must be a number' });
    }

    const result = db.prepare(`
      INSERT INTO receipts (user_id, filename, original_name, file_type, amount, description, ocr_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      req.user.userId,
      req.file.filename,
      req.file.originalname,
      detectedExt,
      parsedAmount,
      description || null
    );

    const receiptId = result.lastInsertRowid;

    // Process asynchronously
    processReceiptFile(req.user.userId, receiptId, req.file.path).catch(err => {
      console.error('[RECEIPT] Processing failed:', err);
    });

    res.status(201).json({
      id: receiptId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      amount: parsedAmount,
    });
  } catch (err) {
    console.error('[RECEIPT] Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get candidate transactions for manual matching
router.get('/:id/candidates', (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  const candidates = findMatchingTransactions(req.user.userId, receipt);
  res.json({ candidates });
});

// Re-run system matching for a receipt (optionally re-extract data first)
router.post('/:id/rematch', async (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  // If reextract is explicitly requested, re-run the full extraction process
  // Also auto-re-extract if receipt has no extracted data and LLM is enabled
  const hasNoData = receipt.extracted_total == null && receipt.extracted_date == null && receipt.extracted_vendor == null;
  // Fetch the LLM config once and reuse below (don't re-query)
  const llmConfig = db.prepare('SELECT use_llm_for_receipts FROM user_llm_config WHERE user_id = ?').get(req.user.userId);
  const shouldReextract = req.query.reextract === '1' || (hasNoData && llmConfig?.use_llm_for_receipts);

  if (shouldReextract) {
    const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Receipt file not found' });
    await processReceiptFile(req.user.userId, receipt.id, filePath);
    // Reload receipt with updated data
    const refreshed = db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);
    Object.assign(receipt, refreshed);
  }

  const candidates = findMatchingTransactions(req.user.userId, receipt);

  let matchedTransactionId = null;
  let matchScore = null;

  if (candidates.length > 0) {
    const bestMatch = candidates[0];
    let finalMatchId = bestMatch.id;
    let finalScore = bestMatch.score;

    if (llmConfig?.use_llm_for_receipts && bestMatch.score < 0.7) {
      const llmMatchId = await matchReceiptWithLLM(req.user.userId, receipt.ocr_text, candidates);
      if (llmMatchId) {
        finalMatchId = llmMatchId;
        finalScore = 0.8;
      }
    }

    if (finalScore >= 0.5) {
      matchedTransactionId = finalMatchId;
      matchScore = finalScore;
    } else {
      matchScore = bestMatch.score;
    }
  }

  db.prepare(`
    UPDATE receipts
    SET matched_transaction_id = ?, match_score = ?, matched_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE matched_at END
    WHERE id = ?
  `).run(matchedTransactionId, matchScore, matchedTransactionId, receipt.id);

  const updated = db.prepare(`
    SELECT r.*, t.amount as txn_amount, t.description as txn_description, t.posted as txn_posted
    FROM receipts r
    LEFT JOIN transactions t ON t.id = r.matched_transaction_id
    WHERE r.id = ? AND r.user_id = ?
  `).get(req.params.id, req.user.userId);

  res.json({ ...updated, candidates });
});

// Match a receipt to a transaction
router.post('/:id/match', (req, res) => {
  const { transaction_id } = req.body;
  const db = getDb();

  const receipt = db.prepare('SELECT id FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  if (transaction_id == null) {
    // Unmatch
    db.prepare('UPDATE receipts SET matched_transaction_id = NULL, match_score = NULL, matched_at = NULL WHERE id = ?').run(req.params.id);
    return res.json({ success: true, matched: false });
  }

  // Verify transaction belongs to user
  const txn = db.prepare(`
    SELECT t.id FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE t.id = ? AND c.user_id = ?
  `).get(transaction_id, req.user.userId);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });

  db.prepare('UPDATE receipts SET matched_transaction_id = ?, match_score = 1.0, matched_at = datetime(\'now\') WHERE id = ?')
    .run(transaction_id, req.params.id);

  const updated = db.prepare(`
    SELECT r.*, t.amount as txn_amount, t.description as txn_description, t.posted as txn_posted
    FROM receipts r
    LEFT JOIN transactions t ON t.id = r.matched_transaction_id
    WHERE r.id = ? AND r.user_id = ?
  `).get(req.params.id, req.user.userId);

  res.json({ success: true, matched: true, receipt: updated });
});

// Delete file only (keep receipt record)
router.delete('/:id/file', async (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);
  if (fs.existsSync(filePath)) {
    // Async unlink so we don't block the event loop on large files
    await fs.promises.unlink(filePath).catch(() => {});
    res.json({ success: true, deleted: true });
  } else {
    res.json({ success: true, deleted: false, message: 'File already removed' });
  }
});

// Delete a receipt
router.delete('/:id', async (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  // Delete file from disk (async, non-blocking)
  const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath).catch(() => {});
  }

  db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Serve receipt files — auth via Authorization header, NOT query param
// (query params leak into browser history, referrers, server logs, CDN logs)
router.get('/:id/file', (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT filename, file_type FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);

  // Defense-in-depth: verify resolved path is inside the receipts dir
  // (prevents path traversal even if multer's UUID filename scheme is bypassed)
  const resolved = path.resolve(filePath);
  const expectedDir = path.resolve(RECEIPTS_DIR, req.user.userId.toString());
  if (!resolved.startsWith(expectedDir + path.sep) && resolved !== expectedDir) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  // Set a content type hint for common file types
  const mime = receipt.file_type === 'pdf' ? 'application/pdf'
    : ['jpg', 'jpeg'].includes(receipt.file_type) ? 'image/jpeg'
    : receipt.file_type === 'png' ? 'image/png'
    : receipt.file_type === 'gif' ? 'image/gif'
    : 'application/octet-stream';
  res.setHeader('Content-Type', mime);

  // Inline so receipts render in the browser instead of downloading
  res.setHeader('Content-Disposition', 'inline');

  res.sendFile(resolved);
});

export default router;
