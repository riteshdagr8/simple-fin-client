// Transfer reconciliation service.
//
// A "transfer pair" is an outgoing transaction (negative amount) and an
// incoming transaction (positive amount) between the user's own accounts that
// represent money moving between those accounts — e.g. an e-transfer from
// Checking to Savings. Reconciled pairs cancel out and are excluded from the
// dashboard spending totals.

const DEFAULT_WINDOW_DAYS = 3;
const DEFAULT_MIN_SCORE = 0.72;
const AUTO_SCORE_THRESHOLD = 0.9;

// Transfer-ish tokens used to boost pairs whose descriptions reference
// inter-account movement. Accounts themselves often differ between the two
// sides, so this is a shared-keyword boost, not a requirement.
const TRANSFER_TOKENS = new Set([
  'transfer', 'transfers', 'etransfer', 'e-transfer', 'interac', 'bill', 'payment',
  'pay', 'online', 'banking', 'inter-account', 'inter account', 'account',
  'savings', 'chequing', 'checking', 'credit', 'email', 'money',
]);

const STOP_WORDS = new Set([
  'to', 'from', 'the', 'of', 'and', 'or', 'a', 'an', 'for', 'with', 'your', 'my',
]);

function tokenize(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

// Token Jaccard similarity between two descriptions.
function descriptionScore(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

function transferIndicatorScore(debit, credit) {
  const tokens = new Set([...tokenize(debit.description), ...tokenize(credit.description)]);
  let hits = 0;
  for (const t of tokens) if (TRANSFER_TOKENS.has(t)) hits++;
  return tokens.size ? Math.min(hits / 3, 1) : 0;
}

// Date difference in days between two posted values (YYYY-MM-DD HH:MM:SS).
function dateDiffDays(a, b) {
  const da = new Date(String(a).replace(' ', 'T') + 'Z');
  const db = new Date(String(b).replace(' ', 'T') + 'Z');
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return 9999;
  return Math.abs(da - db) / 86400000;
}

// Score a candidate pair on a 0..1 scale. The blended `score` is used for
// ranking and the reviewable-candidate threshold. `strongSignal` captures the
// highest-confidence case — exact opposite amounts on the same day with both
// sides carrying transfer indicators — which is trusted for auto-pairing even
// when the two banks word the descriptions differently (e.g. "E-Transfer to
// Savings" vs "E-Transfer from Checking").
export function scoreTransferPair(debit, credit, windowDays = DEFAULT_WINDOW_DAYS) {
  const absDebit = Math.abs(debit.amount);
  const absCredit = Math.abs(credit.amount);
  const scale = Math.max(absDebit, absCredit, 1);
  const amountDiff = Math.abs(absDebit - absCredit);
  const amountScore = 1 - Math.min(amountDiff / scale, 1);

  const dd = dateDiffDays(debit.posted, credit.posted);
  const dateScore = dd <= windowDays ? Math.max(0, 1 - dd / windowDays) : 0;

  const desc = descriptionScore(debit.description, credit.description);
  const ind = transferIndicatorScore(debit, credit);

  // Strong signal: essentially equal amounts, within 1 day, and both sides
  // have transfer-y descriptions.
  const strongSignal =
    amountDiff <= Math.max(0.01, scale * 0.002) &&
    dd <= 1 &&
    ind >= 0.66;

  return {
    amountScore,
    dateScore,
    descriptionScore: desc,
    indicatorScore: ind,
    score: 0.45 * amountScore + 0.25 * dateScore + 0.2 * desc + 0.1 * ind,
    strongSignal,
    amountDiff,
    dateDiffDays: dd,
  };
}

// Fetch all unpaired transactions for a user, grouped by account ownership.
function fetchUnpairedTransactions(db, userId) {
  return db.prepare(`
    SELECT t.id, t.account_id, t.amount, t.posted, t.description,
           a.name as account_name, a.currency, a.is_hidden
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE c.user_id = ?
      AND NOT EXISTS (SELECT 1 FROM transfer_pairs tp WHERE tp.debit_txn_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM transfer_pairs tp2 WHERE tp2.credit_txn_id = t.id)
  `).all(userId);
}

// Words that indicate a credit is a refund/return rather than a genuine
// transfer between accounts. A refund on one account and an unrelated charge
// elsewhere should not be suggested as a transfer pair.
const REFUND_TOKENS = /\b(refund|return|reversal|adjustment|adjust|rebate|reversal|cancellation|cancel)\b/i;

function isRefundish(text) {
  return REFUND_TOKENS.test(String(text || ''));
}

// Compute candidate pairs for a user. Not persisted.
export function findTransferCandidates(db, userId, { windowDays = DEFAULT_WINDOW_DAYS, minScore = DEFAULT_MIN_SCORE } = {}) {
  const txns = fetchUnpairedTransactions(db, userId);
  const debits = txns.filter(t => t.amount < 0);
  const credits = txns.filter(t => t.amount > 0);

  const candidates = [];
  for (const debit of debits) {
    for (const credit of credits) {
      if (debit.account_id === credit.account_id) continue;
      // Hidden accounts are duplicates of another visible account (e.g. a
      // joint account synced twice, or a secondary card). Transactions there
      // repeat the same activity — never suggest them as transfers.
      if (debit.is_hidden || credit.is_hidden) continue;
      // A refund (money back on one account) is not a transfer between
      // accounts, even when amounts line up with an unrelated charge.
      if (isRefundish(credit.description)) continue;
      if (debit.currency && credit.currency && debit.currency !== credit.currency) continue;

      // Amount tolerance: within max($0.01, 0.5% of larger).
      const tolerance = Math.max(0.01, Math.max(Math.abs(debit.amount), Math.abs(credit.amount)) * 0.005);
      if (Math.abs(Math.abs(debit.amount) - Math.abs(credit.amount)) > tolerance) continue;

      const scored = scoreTransferPair(debit, credit, windowDays);
      if (scored.dateDiffDays > windowDays) continue;
      if (scored.score < minScore) continue;

      candidates.push({
        debit: { id: debit.id, account_id: debit.account_id, account_name: debit.account_name, amount: debit.amount, posted: debit.posted, description: debit.description },
        credit: { id: credit.id, account_id: credit.account_id, account_name: credit.account_name, amount: credit.amount, posted: credit.posted, description: credit.description },
        ...scored,
      });
    }
  }

  // Deterministic ordering: best score first, then smallest amount/date gap,
  // then lowest txn ids.
  candidates.sort((a, b) =>
    b.score - a.score ||
    a.amountDiff - b.amountDiff ||
    a.dateDiffDays - b.dateDiffDays ||
    a.debit.id - b.debit.id ||
    a.credit.id - b.credit.id
  );

  // Greedy one-to-one: each transaction can be proposed in at most one pair.
  const usedDebit = new Set();
  const usedCredit = new Set();
  const unique = [];
  for (const c of candidates) {
    if (usedDebit.has(c.debit.id) || usedCredit.has(c.credit.id)) continue;
    usedDebit.add(c.debit.id);
    usedCredit.add(c.credit.id);
    unique.push(c);
  }
  return unique;
}

// Auto-pair strong-signal transfers for a user. Used after a bank sync or CSV
// import so new transfers pair without requiring a manual scan. Only pairs
// transactions that are still unpaired; returns the number auto-paired.
export function autoPairTransfers(db, userId, { windowDays = DEFAULT_WINDOW_DAYS, minScore = DEFAULT_MIN_SCORE } = {}) {
  const candidates = findTransferCandidates(db, userId, { windowDays, minScore });
  const toPair = candidates.filter(c => c.strongSignal);

  const insert = db.prepare(`
    INSERT INTO transfer_pairs (user_id, debit_txn_id, credit_txn_id, matched_by)
    VALUES (?, ?, ?, 'auto')
  `);
  let paired = 0;
  const doPair = db.transaction((items) => {
    for (const c of items) {
      // Re-check inside the transaction in case of a race.
      const existing = db.prepare(`
        SELECT id FROM transfer_pairs
        WHERE debit_txn_id = ? OR credit_txn_id = ?
           OR debit_txn_id = ? OR credit_txn_id = ?
      `).get(c.debit.id, c.debit.id, c.credit.id, c.credit.id);
      if (existing) continue;
      insert.run(userId, c.debit.id, c.credit.id);
      paired++;
    }
  });
  doPair(toPair);

  if (paired > 0) {
    console.log(`[TRANSFERS] Auto-paired ${paired} transfer(s) for user ${userId}.`);
  }
  return paired;
}

// Validate that two transactions form a legal pair for the user.
// Returns { ok: true } or { ok: false, status, error }.
export function validatePair(db, userId, debitTxnId, creditTxnId) {
  if (!Number.isInteger(debitTxnId) || !Number.isInteger(creditTxnId)) {
    return { ok: false, status: 400, error: 'debit_txn_id and credit_txn_id must be integers' };
  }
  if (debitTxnId === creditTxnId) {
    return { ok: false, status: 400, error: 'debit and credit transactions must be different' };
  }

  const txn = (id) => db.prepare(`
    SELECT t.*, a.name as account_name, a.currency, a.id as account_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE t.id = ? AND c.user_id = ?
  `).get(id, userId);

  const debit = txn(debitTxnId);
  const credit = txn(creditTxnId);
  if (!debit || !credit) return { ok: false, status: 404, error: 'Transaction not found' };
  if (debit.account_id === credit.account_id) {
    return { ok: false, status: 400, error: 'Both transactions must be in different accounts' };
  }
  if (debit.currency && credit.currency && debit.currency !== credit.currency) {
    return { ok: false, status: 400, error: 'Accounts have different currencies' };
  }
  // Debit must be money out, credit must be money in.
  if (debit.amount >= 0) return { ok: false, status: 400, error: 'First transaction must be a debit (negative amount)' };
  if (credit.amount <= 0) return { ok: false, status: 400, error: 'Second transaction must be a credit (positive amount)' };

  const paired = db.prepare(`
    SELECT id FROM transfer_pairs
    WHERE debit_txn_id = ? OR credit_txn_id = ?
       OR debit_txn_id = ? OR credit_txn_id = ?
  `).get(debitTxnId, debitTxnId, creditTxnId, creditTxnId);
  if (paired) return { ok: false, status: 409, error: 'One of these transactions is already reconciled' };

  return { ok: true, debit, credit };
}

export { AUTO_SCORE_THRESHOLD, DEFAULT_WINDOW_DAYS, DEFAULT_MIN_SCORE };
