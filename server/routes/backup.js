import { Router } from 'express';
import { getDb } from '../db.js';
import XLSX from 'xlsx';

const router = Router();

router.get('/download', (req, res) => {
  const db = getDb();
  const uid = req.user.userId;

  // 1. Accounts
  const accounts = db.prepare(`
    SELECT a.id, a.simplefin_id, a.name, a.bank_name, a.currency, a.balance, a.balance_date,
           a.is_hidden, a.created_at, c.name as connection_name
    FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE c.user_id = ?
    ORDER BY a.id
  `).all(uid);

  // 2. Categories
  const categories = db.prepare(`
    SELECT id, name, icon, color, is_default, created_at
    FROM categories
    WHERE user_id = ?
    ORDER BY id
  `).all(uid);

  // 3. Transactions — include account name and category for readability
  const transactions = db.prepare(`
    SELECT t.id, t.simplefin_txn_id, t.posted, t.amount, t.description,
           a.name as account_name, a.bank_name,
           cat.name as category_name, tc.confidence,
           t.created_at
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    LEFT JOIN categories cat ON cat.id = tc.category_id
    WHERE c.user_id = ?
    ORDER BY t.posted DESC, t.id
  `).all(uid);

  // Build workbook
  const wb = XLSX.utils.book_new();

  const accSheet = XLSX.utils.json_to_sheet(accounts);
  XLSX.utils.book_append_sheet(wb, accSheet, 'Accounts');

  const catSheet = XLSX.utils.json_to_sheet(categories);
  XLSX.utils.book_append_sheet(wb, catSheet, 'Categories');

  const txnSheet = XLSX.utils.json_to_sheet(transactions);
  XLSX.utils.book_append_sheet(wb, txnSheet, 'Transactions');

  // Auto-size columns for readability
  [accSheet, catSheet, txnSheet].forEach(sheet => {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const cols = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      let maxLen = 10;
      for (let r = range.s.r; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined && cell.v !== null) {
          maxLen = Math.max(maxLen, String(cell.v).length);
        }
      }
      cols.push({ wch: Math.min(maxLen + 3, 60) });
    }
    sheet['!cols'] = cols;
  });

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="simplefin-backup-${date}.xlsx"`);
  res.send(buf);
});

export default router;
