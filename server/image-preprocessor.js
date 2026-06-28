import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TARGET_WIDTH = 2550; // ~300 DPI for 8.5" width (for OCR)
const LLM_MAX_WIDTH = 400; // small for LLM API (endpoint has strict payload limits ~20KB)

export async function preprocessImage(inputPath) {
  const tempPath = path.join(os.tmpdir(), `receipt-preprocessed-${Date.now()}.png`);
  try {
    await sharp(inputPath)
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1, flat: 1, jagged: 2 })
      .resize({ width: TARGET_WIDTH, fit: 'inside', withoutEnlargement: false })
      .png({ compressionLevel: 3 })
      .toFile(tempPath);
    return tempPath;
  } catch (err) {
    console.error('[PREPROCESS] Image preprocessing failed, using original:', err.message);
    return inputPath;
  }
}

export async function preprocessImageForLLM(inputPath) {
  const tempPath = path.join(os.tmpdir(), `receipt-llm-${Date.now()}.jpg`);
  try {
    // First trim whitespace/garbage borders, then resize
    // sharp.trim() detects background color from top-left pixel and removes similar edges
    await sharp(inputPath)
      .trim({ threshold: 30 })  // remove edges similar to background (tolerance 30/255)
      .resize({ width: LLM_MAX_WIDTH, fit: 'inside', withoutEnlargement: false })
      .jpeg({ quality: 50 })
      .toFile(tempPath);
    return tempPath;
  } catch (err) {
    console.error('[PREPROCESS] LLM image preprocessing failed, using original:', err.message);
    return inputPath;
  }
}

export async function pdfToImages(pdfPath, outputDir) {
  const outDir = outputDir || os.tmpdir();
  const prefix = `receipt-pdf-${Date.now()}`;

  try {
    // Try sharp's PDF rendering (works for single-page PDFs with libvips PDF support)
    const outputPath = path.join(outDir, `${prefix}.png`);
    await sharp(pdfPath, { page: 0 })
      .png()
      .toFile(outputPath);
    return [outputPath];
  } catch (err) {
    console.error('[PREPROCESS] sharp PDF render failed:', err.message);
    // Fall back: return null so caller uses pdf-parse text instead
    return null;
  }
}

export async function fileToBase64(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tiff': 'image/tiff' };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function cleanupTempFile(filePath) {
  try {
    if (filePath && filePath.startsWith(os.tmpdir())) {
      await fs.promises.unlink(filePath);
    }
  } catch {}
}
