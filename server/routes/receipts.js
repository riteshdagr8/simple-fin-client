import { Router } from 'express';
import { getDb } from '../db.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECEIPTS_DIR = path.join(__dirname, '..', '..', 'data', 'receipts');

// Ensure receipts directory exists
if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
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

  // Find candidate transactions with matching amount (if receipt has an amount)
  let candidates = [];
  if (receipt.amount != null) {
    candidates = db.prepare(`
      SELECT t.id, t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ? AND t.amount = ? AND (a.is_hidden IS NULL OR a.is_hidden = 0)
      ORDER BY t.posted DESC
      LIMIT 20
    `).all(req.user.userId, receipt.amount);
  }

  res.json({ ...receipt, candidates });
});

// Upload a receipt (handled via multipart-ish: base64 data in JSON body)
router.post('/upload', (req, res) => {
  const { filename, originalName, data, amount, description } = req.body;
  if (!data || !filename) {
    return res.status(400).json({ error: 'filename and data (base64) are required' });
  }

  // Validate amount if provided
  const parsedAmount = amount != null ? Number(amount) : null;
  if (parsedAmount != null && isNaN(parsedAmount)) {
    return res.status(400).json({ error: 'amount must be a number' });
  }

  // Save image to disk
  const buffer = Buffer.from(data, 'base64');
  const ext = path.extname(filename) || '.jpg';
  const safeFilename = crypto.randomBytes(8).toString('hex') + ext;
  const filePath = path.join(RECEIPTS_DIR, safeFilename);
  fs.writeFileSync(filePath, buffer);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO receipts (user_id, filename, original_name, amount, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.userId, safeFilename, originalName || filename, parsedAmount, description || null);

  res.status(201).json({
    id: result.lastInsertRowid,
    filename: safeFilename,
    originalName: originalName || filename,
    amount: parsedAmount,
  });
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
  const filePath = path.join(RECEIPTS_DIR, receipt.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Serve receipt images
router.get('/:id/image', (req, res) => {
  const db = getDb();
  const receipt = db.prepare('SELECT filename FROM receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

  const filePath = path.join(RECEIPTS_DIR, receipt.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Image file not found' });

  res.sendFile(filePath);
});

export default router;
