import { createWorker } from 'tesseract.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { getDb } from './db.js';
import { chat } from './llm.js';

const DATE_PATTERNS = [
  /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g,
  /\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/g,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[.,\s]+(\d{1,2})[,\s]+(\d{4})\b/gi,
];

const TOTAL_PATTERNS = [
  /(?:total|amount due|balance due|grand total|total due)[:\s]*\$?([\d,]+\.\d{2})/gi,
  /\$([\d,]+\.\d{2})\s*$/gm,
];

export async function extractFromImage(filePath) {
  const worker = await createWorker('eng');
  try {
    const { data: { text } } = await worker.recognize(filePath);
    return text;
  } finally {
    await worker.terminate();
  }
}

export async function extractFromPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(buffer);
  const parser = new PDFParse(uint8Array);
  await parser.load();
  const result = await parser.getText();
  parser.destroy();
  return result.text;
}

export function parseReceiptText(text) {
  const result = { total: null, date: null, vendor: null };

  // Extract total
  for (const pattern of TOTAL_PATTERNS) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1][1];
      result.total = parseFloat(lastMatch.replace(',', ''));
      break;
    }
  }

  // Extract date
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const dateStr = match[0];
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        result.date = parsed.toISOString().split('T')[0];
        break;
      }
    }
  }

  // Extract vendor (first non-trivial capitalized line)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines.slice(0, 10)) {
    if (line.length > 3 && line.length < 50 && /^[A-Z]/.test(line) && !/^\d/.test(line)) {
      result.vendor = line;
      break;
    }
  }

  return result;
}

export function findMatchingTransactions(userId, receipt) {
  const db = getDb();

  // Query transactions within ±3 days of extracted date
  let candidates = [];
  if (receipt.extracted_date) {
    const dateStr = receipt.extracted_date;
    candidates = db.prepare(`
      SELECT t.id, t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ?
        AND (a.is_hidden IS NULL OR a.is_hidden = 0)
        AND t.posted >= datetime(?, '-3 days')
        AND t.posted <= datetime(?, '+3 days')
      ORDER BY t.posted DESC
      LIMIT 50
    `).all(userId, dateStr, dateStr);
  } else {
    // No date extracted, get recent transactions
    candidates = db.prepare(`
      SELECT t.id, t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ? AND (a.is_hidden IS NULL OR a.is_hidden = 0)
      ORDER BY t.posted DESC
      LIMIT 50
    `).all(userId);
  }

  if (candidates.length === 0) return [];

  // Score candidates
  const scored = candidates.map(txn => {
    let score = 0;

    // Amount match (weight 0.4)
    if (receipt.extracted_total != null) {
      const receiptAmt = Math.abs(receipt.extracted_total);
      const txnAmt = Math.abs(txn.amount);
      const diff = Math.abs(receiptAmt - txnAmt);
      if (diff < 0.01) {
        score += 0.4;
      } else if (diff / txnAmt < 0.01) {
        score += 0.3;
      }
    }

    // Date proximity (weight 0.3)
    if (receipt.extracted_date) {
      const receiptDate = new Date(receipt.extracted_date);
      const txnDate = new Date(txn.posted);
      const daysDiff = Math.abs((receiptDate - txnDate) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 1) {
        score += 0.3;
      } else if (daysDiff <= 3) {
        score += 0.2;
      }
    }

    // Vendor/description fuzzy match (weight 0.3)
    if (receipt.extracted_vendor && txn.description) {
      const fuse = new Fuse([{ text: txn.description }], { keys: ['text'], threshold: 0.6 });
      const results = fuse.search(receipt.extracted_vendor);
      if (results.length > 0) {
        score += 0.3 * (1 - results[0].score);
      }
    }

    return { ...txn, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

export async function matchReceiptWithLLM(userId, receiptText, candidates) {
  if (!receiptText || candidates.length === 0) return null;

  const topCandidates = candidates.slice(0, 5);
  const candidateList = topCandidates.map((c, i) =>
    `${i + 1}. ID: ${c.id}, Date: ${c.posted}, Amount: $${Math.abs(c.amount).toFixed(2)}, Description: ${c.description}`
  ).join('\n');

  const prompt = `You are a receipt matching assistant. Given a receipt text and a list of transaction candidates, identify which transaction best matches the receipt.

Receipt text:
${receiptText}

Candidate transactions:
${candidateList}

Respond with ONLY the transaction ID number (1-5) that best matches, or 0 if none match. No explanation.`;

  try {
    const response = await chat(userId, [
      { role: 'user', content: prompt }
    ], { temperature: 0 });

    const matchNum = parseInt(response.trim());
    if (matchNum >= 1 && matchNum <= topCandidates.length) {
      return topCandidates[matchNum - 1].id;
    }
  } catch (err) {
    console.error('[RECEIPT] LLM matching failed:', err.message);
  }

  return null;
}

export async function processReceiptFile(userId, receiptId, filePath) {
  const db = getDb();

  try {
    // Extract text based on file type
    const ext = path.extname(filePath).toLowerCase();
    let text = '';

    if (ext === '.pdf') {
      text = await extractFromPdf(filePath);
    } else {
      text = await extractFromImage(filePath);
    }

    // Parse receipt
    const parsed = parseReceiptText(text);

    // Update receipt with extracted data
    db.prepare(`
      UPDATE receipts
      SET extracted_total = ?, extracted_vendor = ?, extracted_date = ?,
          ocr_text = ?, ocr_status = 'completed'
      WHERE id = ?
    `).run(parsed.total, parsed.vendor, parsed.date, text, receiptId);

    // Find matching transactions
    const updatedReceipt = { ...parsed, extracted_total: parsed.total, extracted_vendor: parsed.vendor, extracted_date: parsed.date };
    const candidates = findMatchingTransactions(userId, updatedReceipt);

    if (candidates.length > 0) {
      const bestMatch = candidates[0];

      // Check if LLM should be used
      const llmConfig = db.prepare('SELECT use_llm_for_receipts FROM user_llm_config WHERE user_id = ?').get(userId);
      let finalMatchId = bestMatch.id;
      let finalScore = bestMatch.score;

      if (llmConfig?.use_llm_for_receipts && bestMatch.score < 0.7) {
        const llmMatchId = await matchReceiptWithLLM(userId, text, candidates);
        if (llmMatchId) {
          finalMatchId = llmMatchId;
          finalScore = 0.8; // LLM confidence
        }
      }

      // Auto-match if score is high enough
      if (finalScore >= 0.7) {
        db.prepare(`
          UPDATE receipts
          SET matched_transaction_id = ?, match_score = ?
          WHERE id = ?
        `).run(finalMatchId, finalScore, receiptId);
      } else {
        db.prepare('UPDATE receipts SET match_score = ? WHERE id = ?').run(bestMatch.score, receiptId);
      }
    }

  } catch (err) {
    console.error('[RECEIPT] Processing failed:', err);
    db.prepare("UPDATE receipts SET ocr_status = 'failed' WHERE id = ?").run(receiptId);
  }
}
