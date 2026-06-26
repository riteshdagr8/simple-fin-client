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

  // Seed default keyword rules for each category
  seedKeywordRules(db, req.user.userId);

  res.json({ seeded: count });
});

function seedKeywordRules(db, userId) {
  // Each rule maps a keyword phrase to a category.
  // descriptionMatchesPattern() does case-insensitive word-boundary matching.
  const ruleDefs = [
    // Groceries
    { category: 'Groceries', keywords: ['LOBLAWS', 'SOBEYS', 'METRO', 'FOOD BASICS', 'FRESHCO', 'LONGOS', 'FORTINOS', 'FARM BOY', 'NATURAL GROCERS', 'COSTCO WHOLESALE', 'WHOLE FOODS', 'TRADER JOES', 'SUPERSTORE', 'REAL CANADIAN', 'NO FRILLS', 'PROVIGO', 'IGA', 'MAXI', 'MARCHE', 'PROVIGO', 'VALU MART', 'FOODLAND', 'GIANT TIGER', 'WALMART GROCERY', 'WALMART SUPERC'] },
    // Dining
    { category: 'Dining', keywords: ['STARBUCKS', 'TIM HORTONS', 'TIM HORTON', 'MCDONALD', 'SUBWAY', 'A&W', 'HARVEY', 'SWISS CHALET', 'PIZZA HUT', 'DOMINOS', 'DOORDASH', 'UBER EATS', 'SKIP THE DISHES', 'SKIP THE DISH', 'GRUBHUB', 'POPEYES', 'WENDY', 'BURGER KING', 'KFC', 'TACO BELL', 'FATBURGER', 'PANDA EXPRESS', 'PHO', 'SUSHI', 'RESTAURANT', 'CAFÉ', 'COFFEE', 'COFFEE SHOP'] },
    // Insurance
    { category: 'Insurance', keywords: ['INTACT', 'AVIVA', 'DESJARDINS', 'STATE FARM', 'ALLSTATE', 'GEICO', 'PROGRESSIVE', 'LIBERTY MUTUAL', 'NATIONWIDE', 'USAA', 'FARMERS', 'INSURANCE', 'HOME INSURANCE', 'AUTO INSURANCE', 'LIFE INSURANCE', 'HEALTH INSURANCE', 'RBC INSURANCE', 'TD INSURANCE', 'WAWANESA'] },
    // Gas/Auto
    { category: 'Gas/Auto', keywords: ['SHELL', 'ESSO', 'PETRO-CANADA', 'PETRO CANADA', 'SUNOCO', 'HUSKY', 'COSTCO GAS', 'CANADIAN TIRE GAS', 'MR. LUBE', 'MR LUBE', 'JIFFY LUBE', 'MIDAS', 'CANADIAN TIRE GASOLINE', 'KAL TIRE', 'CALTAIRE', 'VALVOLINE', 'OIL CHANGE', 'TIRE', 'WHEEL', 'AUTO', 'CAR WASH', 'SERVICE GAS'] },
    // Shopping
    { category: 'Shopping', keywords: ['AMAZON', 'WALMART', 'BEST BUY', 'IKEA', 'WINNERS', 'MARSHALLS', 'HOMESENSE', 'HOME DEPOT', 'LOWES', 'HOME HARDWARE', 'RONA', 'CANADIAN TIRE', 'THE BAY', 'HBC', 'NORDSTROM', 'SEPHORA', 'STAPLES', 'DOLLARAMA', 'DOLLAR TREE', 'WALMART', 'SHOPPERS DRUG MART', 'PHARMASAVE', 'SHOES', 'CLOTHING'] },
    // Entertainment
    { category: 'Entertainment', keywords: ['NETFLIX', 'SPOTIFY', 'DISNEY PLUS', 'DISNEY+', 'CRAPPLE MUSIC', 'APPLE MUSIC', 'YOUTUBE', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'GOG.COM', 'EPIC GAMES', 'HULU', 'AMAZON PRIME', 'AMCR+', 'CRUNCHYROLL', 'APPLE TV', 'BELL MEDIA', 'ROGERS MEDIA', 'CINEMA', 'MOVIE', 'THEATRE', 'AMC', 'CINEPLEX', 'TIKTOK', 'TWITCH', 'AMAZON PRIME VIDEO', 'DISNEY+'] },
    // Travel
    { category: 'Travel', keywords: ['AIR CANADA', 'WESTJET', 'PORTER', 'FLAIR', 'SUNWING', 'TRANSCAFTA', 'AIR TRANSAT', 'VIA RAIL', 'GO TRANSIT', 'MARQUIS', 'MARRIOTT', 'HILTON', 'HYATT', 'ACCOR', 'IHG', 'BEST WESTERN', 'AIRBNB', 'BOOKING.COM', 'EXPEDIA', 'TRIPADVISOR', 'VIA RAIL', 'BUSBUD', 'REDHAT', 'RED CATS', 'RED CAT', 'RED CAR', 'RENTAL', 'TOLL', 'PARKING', 'AIRPORT', 'LOUNGE', 'HOTEL', 'MOTEL', 'INN', 'YOUTH HOSTEL'] },
    // Education
    { category: 'Education', keywords: ['UNIVERSITY', 'COLLEGE', 'TUITION', 'SCHOOL', 'COURSERA', 'UDEMY', 'LYNDA', 'PLURALSIGHT', 'LEARNER', 'EDUCATION', 'SCHOLARSHIP', 'STUDENT LOAN', 'BOOKS', 'CANVAS', 'BLACKBOARD', 'MYCLASS', 'WILFRID LAURIER', 'UNIVERSITY OF TORONTO', 'RYERSON', 'TMU', 'YORK UNIVERSITY', 'SENeca'] },
    // Utilities
    { category: 'Utilities', keywords: ['BELL CANADA', 'ROGERS', 'TELUS', 'SHAW', 'FIDO', 'KOODO', 'FREEDOM MOBILE', 'FIDO', 'TELUS MOBILITY', 'ROGERS WIRELESS', 'TELUS MOBILE', 'TELUS INTERNET', 'ROGERS INTERNET', 'BELL MOBILITY', 'BELL MTS', 'FREEDOM', 'KOODO', 'TELUS', 'ROGERS', 'BELL', 'HYDRO', 'HYDRO QUEBEC', 'HYDRO OTTAWA', 'HYDRO ONE', 'ENBRIDGE', 'ENMAX', 'ATCO', 'FORTIS', 'TRANSALTA', 'BC HYDRO', 'BC HYDRO', 'ONTARIO HYDRO', 'INTACT', 'OVO', 'ENBRIDGE GAS', 'ENBRIDGE GAS INC', 'HYDRO OTTAWA', 'BELL MOBILITY', 'ROGERS WIRELESS', 'ROGERS COMMUNICATIONS', 'SHAW COMMUNICATIONS', 'TELUS MOBILITY'] },
    // Tax/Fee
    { category: 'Tax/Fee', keywords: ['CRA', 'GOVERNMENT OF CANADA', 'GOVERNMENT OF ONTARIO', 'GOVERNMENT OF QUEBEC', 'GOVERNMENT OF BRITISH COLUMBIA', 'REVENUE', 'TAX', 'FEE', 'PENALTY', 'SERVICE CHARGE', 'ADMIN FEE', 'MAINTENANCE FEE', 'MONTHLY FEE', 'ACCOUNT FEE', 'TRANSACTION FEE', 'TAX REFUND', 'PROPERTY TAX', 'INCOME TAX'] },
    // Healthcare
    { category: 'Healthcare', keywords: ['SHOPPERS DRUG MART', 'REXALL', 'PHARMASAVE', 'JEAN COUTU', 'BRUNET', 'UNIPRIX', 'UNIPRIX', 'DOCTOR', 'PHYSICIAN', 'HOSPITAL', 'DENTAL', 'DENTIST', 'VISION', 'EYEGLASSES', 'OPTOMETRIST', 'OPTICIAN', 'CHIROPRACTOR', 'MASSAGE THERAPY', 'PHYSIOTHERAPY', 'MENTAL HEALTH', 'PSYCHOLOGIST', 'PSYCHIATRIST', 'CLINIC', 'MEDICAL', 'LAB', 'IMAGING', 'X-RAY', 'BLOOD WORK', 'PRESCRIPTION', 'RX'] },
    // Income
    { category: 'Income', keywords: ['PAYROLL', 'SALARY', 'DIRECT DEPOSIT', 'EMPLOYER', 'DIVIDEND', 'INTEREST', 'TRANSFER IN', 'DEPOSIT', 'EMPLOYMENT', 'WAGES', 'BONUS', 'COMMISSION', 'REFUND', 'CREDIT', 'REIMBURSEMENT', 'GARNISHMENT', 'CHILD SUPPORT'] },
    // Transfer
    { category: 'Transfer', keywords: ['E-TRANSFER', 'INTERAC', 'INTERAC E-TRANSFER', 'TRANSFER OUT', 'TRANSFER IN', 'BILL PAYMENT', 'BILL PAY', 'BIL', 'PAYMENT TO', 'PAYMENT FROM', 'INTER-ACCOUNT', 'INTER ACCOUNT', 'RECURRING PAYMENT', 'PRE-AUTHORIZED', 'PREAUTHORIZED', 'PRE-AUTH', 'PREAUTH', 'DIRECT DEBIT', 'PAD PAYMENT'] },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO category_rules
      (user_id, category_id, rule_type, match_text, account_ids, patterns, pattern_threshold, priority, enabled)
    VALUES (?, ?, 'keyword', ?, 'all', '[]', 0.6, 0, 1)
  `);

  const getCat = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?');
  let count = 0;

  for (const rule of ruleDefs) {
    const cat = getCat.get(userId, rule.category);
    if (!cat) continue;
    for (const kw of rule.keywords) {
      const r = insert.run(userId, cat.id, kw);
      if (r.changes > 0) count++;
    }
  }

  return count;
}

export default router;
