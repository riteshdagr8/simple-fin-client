import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';
import { processReceiptFile } from '../receipt-processor.js';

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
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
  },
});

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

    const db = getDb();
    const { amount, description } = req.body;

    const parsedAmount = amount ? parseFloat(amount) : null;
    if (parsedAmount != null && isNaN(parsedAmount)) {
      return res.status(400).json({ error: 'amount must be a number' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const result = db.prepare(`
      INSERT INTO receipts (user_id, filename, original_name, file_type, amount, description, ocr_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      req.user.userId,
      req.file.filename,
      req.file.originalname,
      ext.slice(1),
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

// Match a receipt to a transaction
router.post('/:id/match', (req, res) => {
  const { transaction_id } = req.body;
  const db = getDb();

  const receipt = db.prepare('SELECT id FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  if (transaction_id == null) {
    // Unmatch
    db.prepare('UPDATE receipts SET matched_transaction_id = NULL WHERE id = ?').run(req.params.id);
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

  db.prepare('UPDATE receipts SET matched_transaction_id = ? WHERE id = ?')
    .run(transaction_id, req.params.id);

  res.json({ success: true, matched: true, transaction_id });
});

// Delete a receipt
router.delete('/:id', (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  // Delete file from disk
  const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Serve receipt files
router.get('/:id/file', (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT filename, file_type FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(filePath);
});

export default router;
