import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

// List user's categories
router.get('/', (req, res) => {
  const db = getDb();
  res.json(db.prepare(
    'SELECT * FROM categories WHERE user_id = ? ORDER BY is_default DESC, name ASC'
  ).all(req.user.userId));
});

// Create category
router.post('/', (req, res) => {
  const { name, icon, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const db = getDb();

  const dup = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
    .get(req.user.userId, name.trim());
  if (dup) return res.status(409).json({ error: 'Category already exists' });

  const result = db.prepare(
    'INSERT INTO categories (user_id, name, icon, color) VALUES (?, ?, ?, ?)'
  ).run(req.user.userId, name.trim(), icon || '📁', color || '#9ca3af');

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

// Update category
router.put('/:id', (req, res) => {
  const { name, icon, color } = req.body;
  const db = getDb();

  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  if (name && name !== cat.name) {
    const dup = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? AND id != ?')
      .get(req.user.userId, name.trim(), cat.id);
    if (dup) return res.status(409).json({ error: 'Category name already exists' });
  }

  db.prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?')
    .run(name?.trim() || cat.name, icon || cat.icon, color || cat.color, cat.id);

  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id));
});

// Delete category
router.delete('/:id', (req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  const other = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
    .get(req.user.userId, 'Other');
  if (!other) return res.status(400).json({ error: '"Other" category must exist' });
  if (cat.id === other.id) return res.status(400).json({ error: 'Cannot delete "Other"' });

  db.prepare('UPDATE transaction_categories SET category_id = ? WHERE category_id = ?')
    .run(other.id, cat.id);
  db.prepare('DELETE FROM transaction_categories WHERE category_id = ?').run(cat.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);

  res.json({ success: true });
});

// Seed default categories
router.post('/seed', (req, res) => {
  const defaults = [
    { name: 'Groceries', icon: '🛒', color: '#22c55e' },
    { name: 'Dining', icon: '🍽️', color: '#f59e0b' },
    { name: 'Insurance', icon: '🛡️', color: '#3b82f6' },
    { name: 'Gas/Auto', icon: '⛽', color: '#0ea5e9' },
    { name: 'Shopping', icon: '🛍️', color: '#ec4899' },
    { name: 'Entertainment', icon: '🎬', color: '#8b5cf6' },
    { name: 'Travel', icon: '✈️', color: '#06b6d4' },
    { name: 'Education', icon: '📚', color: '#a855f7' },
    { name: 'Utilities', icon: '💡', color: '#64748b' },
    { name: 'Tax/Fee', icon: '🧾', color: '#dc2626' },
    { name: 'Healthcare', icon: '🏥', color: '#ef4444' },
    { name: 'Income', icon: '💰', color: '#16a34a' },
    { name: 'Transfer', icon: '🔄', color: '#6b7280' },
    { name: 'Other', icon: '📁', color: '#9ca3af' },
  ];

  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (user_id, name, icon, color, is_default) VALUES (?, ?, ?, ?, 1)'
  );
  let count = 0;
  for (const cat of defaults) {
    const r = insert.run(req.user.userId, cat.name, cat.icon, cat.color);
    if (r.changes > 0) count++;
  }
  res.json({ seeded: count });
});

export default router;
