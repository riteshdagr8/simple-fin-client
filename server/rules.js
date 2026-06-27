import { getDb } from './db.js';

// Extract common patterns from a list of transaction descriptions
// Returns array of { pattern, count, percentage } sorted by frequency
// Uses 1-word and 2-word phrases that appear in >= threshold% of transactions
export function extractPatterns(descriptions, threshold = 0.6) {
  if (descriptions.length === 0) return [];

  const total = descriptions.length;
  const normalized = descriptions.map(d => d.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim());

  // Count 1-word and 2-word phrases
  const phraseCounts = new Map();
  const stopwords = new Set(['THE', 'A', 'AN', 'AND', 'OR', 'OF', 'TO', 'IN', 'ON', 'AT', 'FOR', 'BY', 'WITH', 'IS', 'WAS', 'WERE', 'BE', 'FROM', 'THIS', 'THAT', 'IT', 'AS', 'BUT', 'NOT', 'HAVE', 'HAS', 'HAD', 'ARE', 'AM', 'NO', 'YES']);

  for (const desc of normalized) {
    const words = desc.split(' ').filter(w => w.length >= 3 && !stopwords.has(w));
    const seen = new Set();
    for (const w of words) {
      if (seen.has(w)) continue;
      seen.add(w);
      phraseCounts.set(w, (phraseCounts.get(w) || 0) + 1);
    }
    // 2-word phrases
    const seen2 = new Set();
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = words[i] + ' ' + words[i + 1];
      if (seen2.has(phrase)) continue;
      seen2.add(phrase);
      phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    }
  }

  // Filter by threshold and convert to array
  const patterns = [];
  for (const [phrase, count] of phraseCounts) {
    const pct = count / total;
    if (pct >= threshold) {
      patterns.push({ pattern: phrase, count, percentage: Math.round(pct * 100) / 100 });
    }
  }

  // Sort by count descending, take top 20
  return patterns.sort((a, b) => b.count - a.count).slice(0, 20);
}

// Check if a transaction description matches a single pattern (case-insensitive, word-boundary)
export function descriptionMatchesPattern(description, pattern) {
  if (!description || !pattern) return false;
  const descUpper = description.toUpperCase();
  const patternUpper = pattern.toUpperCase();
  // Word-boundary regex
  const escaped = patternUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(descUpper);
}

// Apply all enabled rules for a user to a list of transactions
// Returns array of { transaction_id, category_id, source, confidence, matched_rule_id }
// Most specific wins: keyword rules beat history rules; within same type, higher priority wins
export function applyRulesToTransactions(userId, transactions) {
  const db = getDb();
  const rules = db.prepare(`
    SELECT cr.*, c.name as category_name
    FROM category_rules cr
    JOIN categories c ON c.id = cr.category_id
    WHERE cr.user_id = ? AND cr.enabled = 1
    ORDER BY cr.priority DESC, cr.id ASC
  `).all(userId);

  if (rules.length === 0) return [];

  // Pre-parse account_ids JSON for each rule
  for (const rule of rules) {
    try {
      rule.account_ids_parsed = rule.account_ids === 'all' ? null : JSON.parse(rule.account_ids || '[]');
      rule.patterns_parsed = rule.patterns ? JSON.parse(rule.patterns) : [];
    } catch {
      rule.account_ids_parsed = [];
      rule.patterns_parsed = [];
    }
  }

  const results = [];

  for (const txn of transactions) {
    // Check each rule in priority order; first match wins
    for (const rule of rules) {
      // Account filter check
      if (rule.account_ids_parsed && rule.account_ids_parsed.length > 0) {
        if (!rule.account_ids_parsed.includes(txn.account_id)) continue;
      }

      let matched = false;
      let confidence = 0.9;

      if (rule.rule_type === 'keyword') {
        if (rule.match_text && descriptionMatchesPattern(txn.description, rule.match_text)) {
          matched = true;
          confidence = 0.95;
        }
      } else if (rule.rule_type === 'history') {
        // Match if any extracted pattern matches
        for (const pat of rule.patterns_parsed) {
          if (descriptionMatchesPattern(txn.description, pat.pattern)) {
            matched = true;
            // Confidence based on pattern strength
            confidence = Math.min(0.95, 0.6 + (pat.percentage * 0.3));
            break;
          }
        }
      }

      if (matched) {
        results.push({
          transaction_id: txn.id,
          category_id: rule.category_id,
          source: 'rule',
          confidence,
          matched_rule_id: rule.id,
        });
        break; // First match wins
      }
    }
  }

  return results;
}

// Build patterns for a category from its existing categorized transactions
// Returns { patterns: [...], total_transactions: N }
export function buildPatternsForCategory(userId, categoryId, threshold = 0.6) {
  const db = getDb();
  // Transactions don't have user_id directly — join through accounts/connections
  const txns = db.prepare(`
    SELECT t.description
    FROM transactions t
    JOIN transaction_categories tc ON tc.transaction_id = t.id
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE tc.category_id = ? AND c.user_id = ?
  `).all(categoryId, userId);

  const descriptions = txns.map(t => t.description);
  return {
    patterns: extractPatterns(descriptions, threshold),
    total_transactions: descriptions.length,
  };
}
