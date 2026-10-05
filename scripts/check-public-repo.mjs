#!/usr/bin/env node
// Run before every push. Over the whole history of this public repository it proves:
//   1. No tracked path or committed content carries the commercial landing template's identifiers
//      (its licence forbids redistributing its source; see the private zecdoor-landing repo).
//   2. No blob in any commit is byte-identical to a file in the template archive (if present).
//   3. No secret: none of our local secrets (../.secrets) verbatim, no private-key formats, no
//      tokens, no seed phrase (12+ BIP-39 words in a row), no key files, no .env files.
//   4. No preview hostname (the Cloudflare account's workers.dev subdomain is private).
// Usage: node scripts/check-public-repo.mjs [path/to/template.zip]

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ZIP = process.argv[2] ?? path.join(os.homedir(), 'personal/projects/aceternity-ui-templates/agenforce-marketing-template.zip');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

// Identifiers from the template's own components (not generic words).
const MARKERS = ['DottedGlowBackground', 'RevolvingCard', 'ShieldIllustration', 'UserChatIcon', 'shadow-brand', 'manuarora', 'Agenforce', 'agenforce', 'assets.aceternity.com'];
const SELF = 'scripts/check-public-repo.mjs';

const problems = [];
const paths = git('log', '--all', '--name-only', '--format=').split('\n').filter(Boolean);
for (const p of new Set(paths)) if (/agenforce|aceternity|zecdoor-landing\//i.test(p)) problems.push(`path in history: ${p}`);

for (const m of MARKERS) {
  const commits = git('log', '--all', '--format=%h', '-S', m, '--', '.', `:(exclude)${SELF}`).split('\n').filter(Boolean);
  if (commits.length) problems.push(`"${m}" appears in commits ${commits.join(', ')}`);
}

if (fs.existsSync(ZIP)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  execFileSync('unzip', ['-q', '-o', ZIP, '-d', tmp]);
  const tpl = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        const body = fs.readFileSync(f);
        const blob = crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
        tpl.set(blob, path.relative(tmp, f));
      }
    }
  };
  walk(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  const objects = git('rev-list', '--all', '--objects').split('\n');
  for (const line of objects) {
    const [h, p] = line.split(' ');
    if (h && tpl.has(h)) problems.push(`identical to template file ${tpl.get(h)}: ${p ?? h}`);
  }
  console.log(`Compared ${objects.length} objects with ${tpl.size} template files.`);
} else {
  console.log(`Template archive not found at ${ZIP}; skipped the byte-identical comparison.`);
}

// ---------------------------------------------------------------- 3 and 4: secrets, key files, preview host
const SECRETS = path.resolve(ROOT, '../.secrets');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (bytes) => {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
};
// Exact secret values we hold locally; the values themselves are never printed.
const needles = [];
if (fs.existsSync(SECRETS)) {
  const add = (label, v) => v && v.length >= 20 && needles.push({ label, v });
  const near = path.join(SECRETS, 'near-fee-account.json');
  if (fs.existsSync(near)) {
    const k = JSON.parse(fs.readFileSync(near, 'utf8')).private_key ?? '';
    add('NEAR fee account private key', k);
    add('NEAR fee account private key', k.replace(/^ed25519:/, ''));
  }
  const sol = path.join(SECRETS, 'topup-test-wallet.json');
  if (fs.existsSync(sol)) {
    const arr = JSON.parse(fs.readFileSync(sol, 'utf8'));
    add('Solana test wallet secret key', JSON.stringify(arr));
    add('Solana test wallet secret key', arr.join(', '));
    add('Solana test wallet secret key', b58(arr));
    add('Solana test wallet secret key', b58(arr.slice(0, 32)));
  }
  const age = path.join(SECRETS, 'zcash-test-identity.age');
  if (fs.existsSync(age)) for (const l of fs.readFileSync(age, 'utf8').split('\n')) if (l.startsWith('AGE-SECRET-KEY-')) add('age identity', l.trim());
  const ufvk = path.join(SECRETS, 'zcash-test-ufvk.txt');
  if (fs.existsSync(ufvk)) add('Zcash test viewing key', fs.readFileSync(ufvk, 'utf8').trim());
  const keys = path.join(SECRETS, 'zcash-test-wallet/keys.toml');
  if (fs.existsSync(keys)) for (const m of fs.readFileSync(keys, 'utf8').matchAll(/"([^"]{40,})"/g)) add('Zcash test wallet keys.toml', m[1]);
} else {
  console.log(`No ${SECRETS}; skipped the comparison with our own secrets.`);
}
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key'],
  [/AGE-SECRET-KEY-1[0-9A-Z]{20,}/, 'age secret key'],
  [/\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/, 'a 64-byte array (Solana keypair format)'],
  // A NEAR private key has the same shape as a signature, so 1Click's quote signatures
  // ("signature": "ed25519:…", public by design) are excluded; our own key is checked verbatim above.
  [/(?<!"signature"\s*:\s*")\bed25519:[1-9A-HJ-NP-Za-km-z]{80,}/, 'NEAR private key format'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9_-]{30,}/, 'Cloudflare token'],
  [/\b[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/i, 'preview hostname (*.workers.dev)'],
];
// The scanners name these patterns themselves.
const SCANNERS = new Set([SELF, 'scripts/check-copy.mjs']);
const WORDS = new Set(
  fs.readFileSync(path.join(ROOT, 'apps/app/node_modules/@scure/bip39/wordlists/english.js'), 'utf8').match(/[a-z]{3,8}/g) ?? [],
);
const seedRun = (text) => {
  let run = 0;
  // The published BIP-39 test vector ("abandon" × 11 or 23, then "about" or "art") is not a secret.
  text = text.replace(/(?:abandon\s+){11,23}(?:about|art)\b/gi, '');
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    if (!w) continue;
    run = WORDS.has(w) ? run + 1 : 0;
    if (run >= 12) return true;
  }
  return false;
};
for (const p of new Set(paths)) {
  if (/(^|\/)(id_rsa|id_ed25519)[^/]*$|\.(pem|key|p12|pfx|age|keystore)$|(^|\/)\.dev\.vars$|(^|\/)\.secrets\/|keypair[^/]*\.json$/i.test(p))
    problems.push(`key file in history: ${p}`);
  if (/(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/(^|\/)\.env\.e2e$/.test(p)) problems.push(`.env file in history: ${p}`);
}
const blobs = git('rev-list', '--all', '--objects').split('\n').map((l) => l.split(' ')).filter(([h, p]) => h && p);
const seen = new Set();
let scanned = 0;
for (const [h, p] of blobs) {
  if (seen.has(h) || git('cat-file', '-t', h).trim() !== 'blob') continue;
  seen.add(h);
  const buf = execFileSync('git', ['cat-file', 'blob', h], { cwd: ROOT, maxBuffer: 1 << 28 });
  if (buf.length > 5_000_000 || buf.includes(0)) continue; // binaries (wasm, images): text checks do not apply
  const text = buf.toString('utf8');
  scanned++;
  for (const n of needles) if (text.includes(n.v)) problems.push(`${n.label} found in ${p} (${h.slice(0, 8)})`);
  if (SCANNERS.has(p)) continue;
  for (const [re, label] of PATTERNS) if (re.test(text)) problems.push(`${label} in ${p} (${h.slice(0, 8)})`);
  if (!/wordlist|bip39/i.test(p) && seedRun(text)) problems.push(`possible seed phrase (12+ BIP-39 words in a row) in ${p} (${h.slice(0, 8)})`);
}
console.log(`Scanned ${scanned} text blobs across the history for ${needles.length} local secret values and ${PATTERNS.length} patterns.`);

if (problems.length) {
  console.error('Public repo check FAILED:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Public repo check passed: no template-derived files, no secrets, no key files and no preview hostname in the history.');
