import { createWorker } from 'tesseract.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
import fs from 'fs';
import path from 'path';
import os from 'os';
import Fuse from 'fuse.js';
import { getDb } from './db.js';
import { chat, isVisionModel } from './llm.js';
import { preprocessImage, preprocessImageForLLM, pdfToImages, fileToBase64, cleanupTempFile } from './image-preprocessor.js';

const TOTAL_PATTERNS = [
  /(?:total|amount due|balance due|grand total|total due)[:\s]*\$?([\d,]+\.\d{2})/gi,
  /\$([\d,]+\.\d{2})\s*$/gm,
];

const EXTRACTION_PROMPT = `You are a receipt parser. Examine this receipt image and extract the following fields as JSON:

- total: the final total amount as a number (e.g. 42.50). Use the amount actually charged (after discounts, before tax if separate, or the final amount paid).
- vendor: the store or merchant name as a string
- date: the transaction date in ISO 8601 format YYYY-MM-DD
- confidence: a number 0-1 indicating how confident you are in the extraction

Respond with ONLY a JSON object. No markdown fences, no explanation. Example: {"total": 42.50, "vendor": "STARBUCKS", "date": "2026-06-15", "confidence": 0.95}
If a field is not visible or cannot be determined, use null for that field.`;

export async function extractFromImage(filePath) {
  let tempPath = null;
  try {
    tempPath = await preprocessImage(filePath);
    const worker = await createWorker('eng', 1, { logger: () => {} });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '4' });
      const { data: { text } } = await worker.recognize(tempPath);
      return text;
    } finally {
      await worker.terminate();
    }
  } finally {
    await cleanupTempFile(tempPath);
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

export async function extractReceiptWithLLM(userId, filePath, fileType) {
  let imagePath = filePath;
  let tempPath = null;
  let ocrText = null;

  try {
    // Get model info to check if vision is supported
    const config = await (await import('./llm.js')).getUserConfig(userId);
    const model = config?.model || '';
    const supportsVision = isVisionModel(model, config?.supportsVision);

    // Extract OCR text first (always useful as fallback)
    if (fileType === 'pdf') {
      try { ocrText = await extractFromPdf(filePath); } catch {}
      if (!ocrText || ocrText.trim().length < 50) {
        // Scanned PDF — convert to image first, then OCR
        const pdfImages = await pdfToImages(filePath);
        if (pdfImages && pdfImages.length > 0) {
          try { ocrText = await extractFromImage(pdfImages[0]); } catch {}
          await cleanupTempFile(pdfImages[0]);
        }
      }
    } else {
      try { ocrText = await extractFromImage(filePath); } catch {}
    }

    if (supportsVision) {
      // Vision model — send image (resized for LLM API)
      if (fileType === 'pdf') {
        const images = await pdfToImages(filePath);
        if (!images || images.length === 0) {
          console.log('[RECEIPT] Could not convert PDF to image for LLM extraction');
          return ocrText ? extractFromTextLLM(userId, ocrText) : null;
        }
        // Resize PDF image for LLM
        tempPath = await preprocessImageForLLM(images[0]);
        imagePath = tempPath;
        await cleanupTempFile(images[0]);
      } else {
        tempPath = await preprocessImageForLLM(filePath);
        imagePath = tempPath;
      }

      const base64 = await fileToBase64(imagePath);
      console.log(`[RECEIPT] Sending vision request: ${Math.round(base64.length/1024)}KB base64`);

      // Small delay to avoid rate limiting from rapid successive calls
      await new Promise(r => setTimeout(r, 1000));

      // Retry up to 2 times on network errors
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await chat(userId, [
            { role: 'user', content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: base64 } },
            ]},
          ], { temperature: 0, maxTokens: 1024 });

          return parseExtractionResponse(response);
        } catch (err) {
          lastError = err;
          if (attempt < 3) {
            const delay = attempt * 3000; // 3s, 6s backoff
            console.log(`[RECEIPT] Vision attempt ${attempt} failed: ${err.message}, retrying in ${delay/1000}s...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      throw lastError;
    } else {
      // Non-vision model — send OCR text
      console.log(`[RECEIPT] Model "${model}" does not support vision, using OCR text for LLM extraction`);
      return extractFromTextLLM(userId, ocrText);
    }
  } catch (err) {
    console.error('[RECEIPT] LLM extraction failed:', err.message, err.cause?.message || '');
    return null;
  } finally {
    await cleanupTempFile(tempPath);
  }
}

const TEXT_EXTRACTION_PROMPT = `You are a receipt parser. Below is OCR-extracted text from a receipt. Extract the following fields as JSON:

- total: the final total amount as a number (e.g. 42.50). Use the amount actually charged.
- vendor: the store or merchant name as a string
- date: the transaction date in ISO 8601 format YYYY-MM-DD
- confidence: a number 0-1 indicating how confident you are in the extraction

Respond with ONLY a JSON object. No markdown fences, no explanation. Example: {"total": 42.50, "vendor": "STARBUCKS", "date": "2026-06-15", "confidence": 0.95}
If a field is not visible or cannot be determined, use null for that field.`;

async function extractFromTextLLM(userId, ocrText) {
  if (!ocrText || ocrText.trim().length < 50) {
    console.log(`[RECEIPT] OCR text too short (${ocrText?.length || 0} chars), skipping LLM text extraction`);
    return null;
  }

  // Check if text has at least some meaningful content (not just garbage)
  const hasDigits = /\d/.test(ocrText);
  const hasLetters = /[a-zA-Z]{3,}/.test(ocrText);
  if (!hasDigits || !hasLetters) {
    console.log(`[RECEIPT] OCR text appears to be garbage (${ocrText.length} chars, no meaningful content), skipping LLM text extraction`);
    return null;
  }

  console.log(`[RECEIPT] Sending ${ocrText.length} chars of OCR text to LLM for extraction`);
  try {
    const response = await chat(userId, [
      { role: 'user', content: `${TEXT_EXTRACTION_PROMPT}\n\nReceipt OCR text:\n${ocrText}` },
    ], { temperature: 0, maxTokens: 1024 });

    return parseExtractionResponse(response);
  } catch (err) {
    console.error('[RECEIPT] Text-based LLM extraction failed:', err.message);
    return null;
  }
}

function parseExtractionResponse(response) {
  let jsonText = response.trim();
  jsonText = jsonText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

  const parsed = JSON.parse(jsonText);
  return {
    total: typeof parsed.total === 'number' ? parsed.total : null,
    vendor: parsed.vendor || null,
    date: parsed.date || null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    source: 'llm',
  };
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

  // Extract date - try multiple formats
  const datePatterns = [
    { regex: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, handler: (m) => {
      let [_, day, month, year] = m;
      if (year.length === 2) year = '20' + year;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }},
    { regex: /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, handler: (m) => {
      const [_, year, month, day] = m;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }},
    { regex: /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[.,\s]+(\d{1,2})[,\s]+(\d{4})/i, handler: (m) => {
      return new Date(m[0]);
    }},
  ];

  for (const { regex, handler } of datePatterns) {
    const match = text.match(regex);
    if (match) {
      const parsed = handler(match);
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
    candidates = db.prepare(`
      SELECT t.id, t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ? AND (a.is_hidden IS NULL OR a.is_hidden = 0)
        AND t.posted >= datetime('now', '-30 days')
      ORDER BY t.posted DESC
    `).all(userId);
  }

  if (candidates.length === 0) return [];

  const scored = candidates.map(txn => {
    let score = 0;

    if (receipt.extracted_total != null) {
      const receiptAmt = Math.abs(receipt.extracted_total);
      const txnAmt = Math.abs(txn.amount);
      const diff = Math.abs(receiptAmt - txnAmt);

      if (receiptAmt !== 0) {
        const pctDiff = (diff / receiptAmt) * 100;
        if (diff === 0) score += 0.5;
        else if (pctDiff < 1) score += 0.45;
        else if (pctDiff < 5) score += 0.4;
        else if (diff < 1) score += 0.35;
        else if (diff < 5) score += 0.3;
        else if (diff < 10) score += 0.2;
      }
    }

    if (receipt.extracted_date) {
      const receiptDate = new Date(receipt.extracted_date);
      const txnDate = new Date(txn.posted);
      const daysDiff = Math.abs((receiptDate - txnDate) / (1000 * 60 * 60 * 24));
      if (daysDiff === 0) score += 0.3;
      else if (daysDiff <= 1) score += 0.25;
      else if (daysDiff <= 3) score += 0.2;
      else if (daysDiff <= 7) score += 0.15;
      else if (daysDiff <= 14) score += 0.1;
    }

    if (receipt.extracted_vendor && txn.description) {
      const fuse = new Fuse([{ text: txn.description }], { keys: ['text'], threshold: 0.8 });
      const results = fuse.search(receipt.extracted_vendor);
      if (results.length > 0) {
        score += 0.2 * (1 - results[0].score);
      }
    }

    return { ...txn, score };
  });

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
  let extractedData = { total: null, vendor: null, date: null, source: 'ocr' };

  try {
    const ext = path.extname(filePath).toLowerCase();
    let text = '';
    let isScannedPdf = false;

    // Step 1: Extract text via OCR or PDF text extraction
    if (ext === '.pdf') {
      text = await extractFromPdf(filePath);
      // If PDF text extraction got very little, it's likely a scanned PDF
      if (text.trim().length < 50) {
        isScannedPdf = true;
        text = await extractFromImage(filePath);
      }
    } else {
      text = await extractFromImage(filePath);
    }

    // Step 2: Parse OCR text with regex
    const ocrParsed = parseReceiptText(text);
    extractedData.total = ocrParsed.total;
    extractedData.vendor = ocrParsed.vendor;
    extractedData.date = ocrParsed.date;

    // Step 3: Check if OCR extracted useful data
    const hasUsefulData = extractedData.total != null || extractedData.date != null;
    const llmConfig = db.prepare('SELECT use_llm_for_receipts FROM user_llm_config WHERE user_id = ?').get(userId);

    if (hasUsefulData && !llmConfig?.use_llm_for_receipts) {
      // OCR got useful data and LLM not enabled — use OCR values
      console.log(`[RECEIPT] OCR extracted useful data, skipping LLM`);
    } else if (hasUsefulData && llmConfig?.use_llm_for_receipts) {
      // OCR got useful data but LLM enabled — try LLM to enhance
      console.log(`[RECEIPT] OCR got data, attempting LLM enhancement for receipt ${receiptId}`);
      const llmResult = await extractReceiptWithLLM(userId, filePath, ext.slice(1));
      if (llmResult) {
        if (llmResult.total != null) extractedData.total = llmResult.total;
        if (llmResult.vendor != null) extractedData.vendor = llmResult.vendor;
        if (llmResult.date != null) extractedData.date = llmResult.date;
        extractedData.source = 'llm';
        console.log(`[RECEIPT] LLM enhanced: total=$${extractedData.total}, vendor=${extractedData.vendor}, date=${extractedData.date}`);
      }
    } else if (!hasUsefulData && llmConfig?.use_llm_for_receipts) {
      // OCR failed to extract useful data — auto-try LLM
      console.log(`[RECEIPT] OCR failed to extract useful data, auto-attempting LLM for receipt ${receiptId}`);
      const llmResult = await extractReceiptWithLLM(userId, filePath, ext.slice(1));
      if (llmResult) {
        if (llmResult.total != null) extractedData.total = llmResult.total;
        if (llmResult.vendor != null) extractedData.vendor = llmResult.vendor;
        if (llmResult.date != null) extractedData.date = llmResult.date;
        extractedData.source = 'llm';
        console.log(`[RECEIPT] LLM rescue succeeded: total=$${extractedData.total}, vendor=${extractedData.vendor}, date=${extractedData.date}`);
      } else {
        console.log(`[RECEIPT] LLM rescue also failed for receipt ${receiptId}`);
      }
    } else {
      console.log(`[RECEIPT] OCR failed and LLM not enabled, receipt ${receiptId} has no extracted data`);
    }

    // Step 4: Update receipt with extracted data
    db.prepare(`
      UPDATE receipts
      SET extracted_total = ?, extracted_vendor = ?, extracted_date = ?,
          ocr_text = ?, ocr_status = 'completed', extraction_source = ?
      WHERE id = ?
    `).run(extractedData.total, extractedData.vendor, extractedData.date, text, extractedData.source, receiptId);

    // Step 5: Find matching transactions
    const updatedReceipt = { extracted_total: extractedData.total, extracted_vendor: extractedData.vendor, extracted_date: extractedData.date };
    const candidates = findMatchingTransactions(userId, updatedReceipt);

    if (candidates.length > 0) {
      const bestMatch = candidates[0];
      let finalMatchId = bestMatch.id;
      let finalScore = bestMatch.score;

      if (llmConfig?.use_llm_for_receipts && bestMatch.score < 0.7) {
        const llmMatchId = await matchReceiptWithLLM(userId, text, candidates);
        if (llmMatchId) {
          finalMatchId = llmMatchId;
          finalScore = 0.8;
        }
      }

      if (finalScore >= 0.5) {
        db.prepare(`
          UPDATE receipts
          SET matched_transaction_id = ?, match_score = ?, matched_at = datetime('now')
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
