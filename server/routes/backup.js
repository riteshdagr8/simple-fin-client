import { Router } from 'express';
import { getDb } from '../db.js';
import ExcelJS from 'exceljs';

const router = Router();

// Add a rows array as a sheet, auto-sizing columns and adding a bold header.
function addSheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name);
  const headers = Object.keys(rows[0] || {});
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(headers.map(h => row[h]));
  }
  // Auto-size columns for readability
  headers.forEach((h, i) => {
    let maxLen = h.length;
    for (const row of rows) {
      const v = row[h];
      if (v !== undefined && v !== null) maxLen = Math.max(maxLen, String(v).length);
    }
    sheet.getColumn(i + 1).width = Math.min(maxLen + 3, 60);
  });
}

router.get('/download', async (req, res) => {
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
  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'Accounts', accounts);
  addSheet(wb, 'Categories', categories);
  addSheet(wb, 'Transactions', transactions);

  const buf = await wb.xlsx.writeBuffer();

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="simplefin-backup-${date}.xlsx"`);
  res.send(buf);
});

export default router;
