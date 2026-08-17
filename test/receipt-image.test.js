import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { preprocessImage, preprocessImageForLLM, pdfToImages, cleanupTempFile } from '../server/image-preprocessor.js';

const tempFiles = new Set();

async function tempPath(name) {
  const filePath = path.join(os.tmpdir(), `simplefin-${process.pid}-${Date.now()}-${name}`);
  tempFiles.add(filePath);
  return filePath;
}

after(async () => {
  await Promise.all([...tempFiles].map(filePath => fs.rm(filePath, { force: true })));
});

describe('receipt image preprocessing', () => {
  it('creates a grayscale PNG resized for OCR', async () => {
    const input = await tempPath('ocr-input.png');
    const output = await tempPath('ocr-output.png');
    await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 220, g: 180, b: 120 } },
    }).png().toFile(input);

    const processed = await preprocessImage(input);
    assert.notEqual(processed, input);
    tempFiles.add(processed);
    const metadata = await sharp(processed).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.width, 2550);
    const { data, info } = await sharp(processed).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 3);
    for (let i = 0; i < data.length; i += 3) {
      assert.equal(data[i], data[i + 1]);
      assert.equal(data[i + 1], data[i + 2]);
    }
    await fs.rename(processed, output);
  });

  it('trims and resizes an image for vision requests', async () => {
    const input = await tempPath('llm-input.png');
    await sharp({
      create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).composite([{ input: { create: { width: 300, height: 120, channels: 3, background: { r: 20, g: 40, b: 80 } } }, left: 150, top: 140 }]).png().toFile(input);

    const processed = await preprocessImageForLLM(input);
    assert.notEqual(processed, input);
    tempFiles.add(processed);
    const metadata = await sharp(processed).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok(metadata.width <= 400);
    assert.ok(metadata.height < 400);
  });

  it('handles PDF rendering through the existing first-page contract', async () => {
    const input = await tempPath('not-a-pdf.pdf');
    await fs.writeFile(input, Buffer.from('%PDF-1.4\ninvalid test fixture\n'));
    const result = await pdfToImages(input);
    assert.ok(result === null || (Array.isArray(result) && result.length === 1));
    if (result) {
      tempFiles.add(result[0]);
      assert.equal((await sharp(result[0]).metadata()).format, 'png');
      await cleanupTempFile(result[0]);
    }
  });
});
