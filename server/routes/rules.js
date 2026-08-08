import { Router } from 'express';
import { getDb } from '../db.js';
import { buildPatternsForCategory, applyRulesToTransactions, descriptionMatchesPattern } from '../rules.js';

const router = Router();

// Verify a list of account IDs all belong to the user. Returns the JSON
// payload to store, or an { error } object if any ID is not owned by the user.
function validateAccountIds(db, userId, accountIds) {
  if (accountIds === 'all' || !accountIds) return { value: 'all' };
  if (!Array.isArray(accountIds) || accountIds.length === 0) return { value: 'all' };
  const ids = [];
  for (const raw of accountIds) {
    if (raw === null || raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return { error: 'account_ids must contain valid positive IDs' };
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length === 0) return { value: 'all' };
  const owned = new Set(db.prepare(`
    SELECT a.id FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id IN (${ids.map(() => '?').join(',')}) AND c.user_id = ?
  `).all(...ids, userId).map(r => r.id));
  const foreign = ids.filter(id => !owned.has(id));
  if (foreign.length > 0) return { error: `Account(s) not found: ${foreign.join(', ')}` };
  return { value: JSON.stringify(ids) };
}

// List all rules for current user
router.get('/', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`
    SELECT cr.*, c.name as category_name, c.icon as category_icon, c.color as category_color
    FROM category_rules cr
    JOIN categories c ON c.id = cr.category_id AND c.user_id = cr.user_id
    WHERE cr.user_id = ?
    ORDER BY cr.priority DESC, cr.id ASC
  `).all(req.user.userId);

  // Parse JSON fields for response
  const parsed = rules.map(r => ({
    ...r,
    account_ids: r.account_ids === 'all' ? 'all' : safeJson(r.account_ids, []),
    patterns: safeJson(r.patterns, []),
  }));
  res.json(parsed);
});

function safeJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// Create a new rule
router.post('/', (req, res) => {
  const { category_id, rule_type, match_text, account_ids, patterns, pattern_threshold, priority, enabled } = req.body;
  if (!category_id || !rule_type) {
    return res.status(400).json({ error: 'category_id and rule_type are required' });
  }
  if (rule_type !== 'keyword' && rule_type !== 'history') {
    return res.status(400).json({ error: 'rule_type must be "keyword" or "history"' });
  }

  const db = getDb();
  // Verify category belongs to user
  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.userId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  let finalPatterns = patterns;
  // For history rules, auto-build patterns if not provided
  if (rule_type === 'history' && (!patterns || patterns.length === 0)) {
    const built = buildPatternsForCategory(req.user.userId, category_id, pattern_threshold || 0.6);
    finalPatterns = built.patterns;
    if (finalPatterns.length === 0) {
      return res.status(400).json({
        error: 'No patterns could be extracted. This category needs more transactions (at least 3) with overlapping words.',
        total_transactions: built.total_transactions,
      });
    }
  }
  if (rule_type === 'keyword' && !match_text) {
    return res.status(400).json({ error: 'match_text is required for keyword rules' });
  }

  // Validate any account scoping against the user's own accounts
  const accountCheck = validateAccountIds(db, req.user.userId, account_ids);
  if (accountCheck.error) return res.status(400).json({ error: accountCheck.error });
  const accountIdsJson = accountCheck.value;

  const result = db.prepare(`
    INSERT INTO category_rules (user_id, category_id, rule_type, match_text, account_ids, patterns, pattern_threshold, priority, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.userId,
    category_id,
    rule_type,
    rule_type === 'keyword' ? match_text : null,
    accountIdsJson,
    rule_type === 'history' ? JSON.stringify(finalPatterns) : null,
    pattern_threshold || 0.6,
    priority || 0,
    enabled === false ? 0 : 1
  );

  res.status(201).json({ id: result.lastInsertRowid, patterns_used: finalPatterns });
});

// Update a rule
router.put('/:id', (req, res) => {
  const { match_text, account_ids, patterns, pattern_threshold, priority, enabled, category_id } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM category_rules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  // Verify new category if changing
  if (category_id && category_id !== existing.category_id) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.userId);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
  }

  // Validate any account scoping against the user's own accounts (only when
  // account_ids is actually being changed; omit it to leave the stored value).
  let accountIdsJson = null;
  if (account_ids !== undefined) {
    const accountCheck = validateAccountIds(db, req.user.userId, account_ids);
    if (accountCheck.error) return res.status(400).json({ error: accountCheck.error });
    accountIdsJson = accountCheck.value;
  }

  db.prepare(`
    UPDATE category_rules SET
      category_id = COALESCE(?, category_id),
      match_text = COALESCE(?, match_text),
      account_ids = COALESCE(?, account_ids),
      patterns = COALESCE(?, patterns),
      pattern_threshold = COALESCE(?, pattern_threshold),
      priority = COALESCE(?, priority),
      enabled = COALESCE(?, enabled)
    WHERE id = ? AND user_id = ?
  `).run(
    category_id ?? null,
    match_text ?? null,
    accountIdsJson === 'all' && account_ids === 'all' ? 'all' : (accountIdsJson ?? null),
    patterns ? JSON.stringify(patterns) : null,
    pattern_threshold ?? null,
    priority ?? null,
    enabled === undefined ? null : (enabled ? 1 : 0),
    req.params.id,
    req.user.userId
  );
  res.json({ success: true });
});

// Delete a rule
router.delete('/:id', (req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT id FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!cat) return res.status(404).json({ error: 'Rule not found' });

  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Preview what a rule would match (without applying it)
router.get('/:id/preview', (req, res) => {
  const db = getDb();
  const rule = db.prepare(`
    SELECT cr.*, c.name as category_name
    FROM category_rules cr
    JOIN categories c ON c.id = cr.category_id
    WHERE cr.id = ? AND cr.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  const accountIdsParsed = rule.account_ids === 'all' ? null : safeJson(rule.account_ids, []);
  const patternsParsed = safeJson(rule.patterns, []);

  let where = ['c.user_id = ?', 'tc.id IS NULL', '(a.is_hidden IS NULL OR a.is_hidden = 0)'];
  const params = [req.user.userId];
  if (accountIdsParsed && accountIdsParsed.length > 0) {
    where.push(`a.id IN (${accountIdsParsed.map(() => '?').join(',')})`);
    params.push(...accountIdsParsed);
  }

  const txns = db.prepare(`
    SELECT t.id, t.description, t.amount, t.posted, a.name as account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    WHERE ${where.join(' AND ')}
    ORDER BY t.posted DESC LIMIT 100
  `).all(...params);

  const matches = [];
  for (const txn of txns) {
    let matched = false;
    let matchedOn = '';
    if (rule.rule_type === 'keyword' && rule.match_text) {
      if (descriptionMatchesPattern(txn.description, rule.match_text)) {
        matched = true;
        matchedOn = rule.match_text;
      }
    } else if (rule.rule_type === 'history') {
      for (const pat of patternsParsed) {
        if (descriptionMatchesPattern(txn.description, pat.pattern)) {
          matched = true;
          matchedOn = pat.pattern;
          break;
        }
      }
    }
    if (matched) {
      matches.push({ ...txn, matched_on: matchedOn });
    }
  }

  res.json({
    rule,
    patterns: patternsParsed,
    match_count: matches.length,
    matches: matches.slice(0, 50),
  });
});

// Apply rules to all uncategorized transactions right now
router.post('/apply-now', (req, res) => {
  const db = getDb();
  const txns = db.prepare(`
    SELECT t.id, t.description, t.amount, t.posted, t.account_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    WHERE c.user_id = ? AND tc.id IS NULL
      AND (a.is_hidden IS NULL OR a.is_hidden = 0)
  `).all(req.user.userId);

  if (txns.length === 0) return res.json({ applied: 0, message: 'No uncategorized transactions' });

  const matches = applyRulesToTransactions(req.user.userId, txns);
  if (matches.length === 0) return res.json({ applied: 0, message: 'No rules matched' });

  const upsert = db.prepare(`
    INSERT INTO transaction_categories (transaction_id, category_id, source, confidence)
    VALUES (?, ?, 'rule', ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      category_id = excluded.category_id,
      source = 'rule',
      confidence = excluded.confidence
  `);

  let applied = 0;
  const apply = db.transaction((items) => {
    for (const m of items) {
      upsert.run(m.transaction_id, m.category_id, m.confidence);
      applied++;
    }
  });
  apply(matches);

  res.json({ applied, total_checked: txns.length });
});

export default router;
