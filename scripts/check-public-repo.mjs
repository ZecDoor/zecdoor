#!/usr/bin/env node
// Run before every push: proves no file derived from the commercial landing template is in
// this public repository's history. The template's licence forbids redistributing its source
// (see the private zecdoor-landing repo).
//   1. No tracked path or committed content carries the template's distinctive identifiers.
//   2. No blob in any commit is byte-identical to a file in the template archive (if present).
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

if (problems.length) {
  console.error('Public repo check FAILED:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Public repo check passed: no template-derived files in history.');
