#!/usr/bin/env node
// Build-blocking copy check. ZecDoor's copy never uses "untraceable", "anonymous" or "hide":
// the privacy it offers is real but partial, and those words would overstate it.
//
// Scans:
//   1. every tracked text file in this repo (and the private landing's source, if checked out
//      next to it), ignoring CSS/HTML tokens such as `overflow-hidden` or `aria-hidden`;
//   2. text inside every tracked image (and the landing's images), by OCR (tesseract.js with
//      a bundled English model, no network). Results are cached by file hash in .cache/.
//      OCR is the second line of defence: every image here is a screenshot of our own pages,
//      whose text comes from the source files scanned in step 1. It can miss small or stylised
//      text, so step 1 is the guarantee and step 2 catches what slips into images some other way.
//
// Usage: node scripts/check-copy.mjs [--text-only]
// Exit code 1 lists every hit with its file (and line, for text).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LANDING = process.env.LANDING_DIR ?? path.resolve(ROOT, '../zecdoor-landing');
const TEXT_ONLY = process.argv.includes('--text-only');
const SELF = path.relative(ROOT, import.meta.filename);

export const BANNED = /\b(untraceable|anonymous(ly)?|anonymi[sz]\w*|hide|hides|hiding|hidden)\b/gi;

// Code tokens that contain "hidden" but are never shown to a reader.
const CODE_TOKENS = [
  /aria-hidden/gi,
  /overflow(-[xy])?[-:]\s*['"]?hidden['"]?/gi, // overflow-hidden, overflow: hidden, overflow: 'hidden'
  /\b(?:[a-z0-9]+:)+hidden\b/gi, // Tailwind variants: lg:hidden, dark:hidden
  /(?<=className=\{?[`'"][^`'"]*)\bhidden\b/g, // a bare `hidden` class inside a className string
  /(?<=cn\([^)]*['"][^'"]*)\bhidden\b/g, // …or inside cn("…")
  /\bhidden(?=[=:]\s*\{?)/g, // the hidden attribute/prop
  /visibility:\s*hidden/gi,
];

const TEXT_EXT = /\.(md|mdx|ts|tsx|js|mjs|cjs|jsx|html|css|json|jsonc|txt|toml|yaml|yml|rs|sh)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const SKIP = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|Cargo\.lock)$|(^|\/)(node_modules|\.next|out|dist|pkg|target|test-results)\//;

function files(dir, tracked) {
  if (!fs.existsSync(dir)) return [];
  const list = tracked
    ? execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n')
    : [];
  return list.filter(Boolean).filter((f) => !SKIP.test(f)).map((f) => path.join(dir, f));
}

function scanText(file) {
  const hits = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    let clean = line;
    for (const t of CODE_TOKENS) clean = clean.replace(t, '');
    for (const m of clean.matchAll(BANNED)) hits.push(`${file}:${i + 1}: "${m[0]}" in: ${line.trim().slice(0, 140)}`);
  });
  return hits;
}

async function scanImages(images) {
  const cacheFile = path.join(ROOT, '.cache/ocr.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const todo = images.filter((f) => !cache[hash(f)]);
  if (todo.length) {
    const { createWorker } = await import('tesseract.js');
    const langPath = path.join(ROOT, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int');
    const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
    const sharp = await loadSharp();
    for (const [n, f] of todo.entries()) {
      process.stdout.write(`\rOCR ${n + 1}/${todo.length} ${path.relative(ROOT, f).slice(-60).padEnd(60)}`);
      let text = '';
      for (const tile of await tiles(f, sharp)) text += (await worker.recognize(tile)).data.text + '\n';
      cache[hash(f)] = { file: path.relative(ROOT, f), text };
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
    process.stdout.write('\n');
    await worker.terminate();
  }
  const hits = [];
  for (const f of images) {
    const text = cache[hash(f)]?.text ?? '';
    for (const m of text.matchAll(BANNED)) hits.push(`${f} (text in image): "${m[0]}"`);
    // OCR sometimes splits large letters ("an onymous"): check the long words with spaces removed.
    for (const m of text.replace(/\s+/g, '').matchAll(/untraceable|anonymous|anonymi[sz]/gi)) {
      if (!hits.some((h) => h.startsWith(f))) hits.push(`${f} (text in image, letters run together): "${m[0]}"`);
    }
  }
  return hits;
}

const OCR_VERSION = 'v3'; // bump when preprocessing changes, so cached text is redone
const hash = (f) => OCR_VERSION + ':' + crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// OCR is most reliable on dark text on a light background at a decent size, so each image is
// turned grey, inverted if it is mostly dark, contrast-stretched, upscaled 2x if small, and read
// in overlapping 1,600-pixel bands so no line of text is cut in half.
async function tiles(file, sharp) {
  if (!sharp) return [file];
  const meta = await sharp(file).metadata();
  const { channels } = await sharp(file).greyscale().stats();
  const dark = (channels[0]?.mean ?? 255) < 128;
  const scale = meta.width < 1500 ? 2 : 1;
  const base = await sharp(file)
    .greyscale()
    .negate(dark ? { alpha: false } : false)
    .normalise()
    .resize({ width: meta.width * scale })
    .png()
    .toBuffer();
  const height = meta.height * scale;
  const width = meta.width * scale;
  // Large display headings are read letter by letter at full size; a half-size copy reads them as words.
  const half = await sharp(base).resize({ width: Math.round(width / 2) }).png().toBuffer();
  const halfH = Math.round(height / 2);
  const out = [];
  for (let top = 0; top < halfH; top += 1200) {
    out.push(await sharp(half).extract({ left: 0, top, width: Math.round(width / 2), height: Math.min(1600, halfH - top) }).png().toBuffer());
    if (top + 1600 >= halfH) break;
  }
  if (height <= 2000) return [base, ...out];
  for (let top = 0; top < height; top += 1200) {
    out.push(await sharp(base).extract({ left: 0, top, width, height: Math.min(1600, height - top) }).png().toBuffer());
    if (top + 1600 >= height) break;
  }
  return out;
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

const textFiles = [...files(ROOT, true), ...files(LANDING, true)].filter((f) => TEXT_EXT.test(f) && !f.endsWith(SELF));
const imageFiles = [...files(ROOT, true), ...files(LANDING, true)].filter((f) => IMAGE_EXT.test(f));

const hits = textFiles.flatMap(scanText);
if (!TEXT_ONLY) hits.push(...(await scanImages(imageFiles)));

if (hits.length) {
  console.error(`Copy check failed: ${hits.length} use(s) of a banned word.\n` + hits.join('\n'));
  process.exit(1);
}
console.log(`Copy check passed: ${textFiles.length} text files${TEXT_ONLY ? '' : `, ${imageFiles.length} images`}.`);
