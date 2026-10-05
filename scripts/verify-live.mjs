#!/usr/bin/env node
// Compares the app you just built from this repository with the app as deployed, file by file.
// The app is the part that builds and checks the transactions you sign, so this is the check
// that matters. Usage, after building the app (see README, "Verify the build"):
//   node scripts/verify-live.mjs [https://zecdoor.0xo.in]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SITE = (process.argv[2] ?? 'https://zecdoor.0xo.in').replace(/\/$/, '');
const LOCAL = path.resolve(import.meta.dirname, '../apps/app/dist');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const get = async (u) => {
  const r = await fetch(u, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const build = await fetch(`${SITE}/build.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (build) console.log(`Live site built from commit ${build.commit}${build.dirty ? ' (with uncommitted changes)' : ''}.`);
if (!fs.existsSync(LOCAL)) throw new Error(`No local build at ${LOCAL}. Build the app first (README, "Verify the build").`);

// Every file of your build (source maps aside, which are not deployed) must be live and identical,
// and the live index.html must load nothing your build does not have.
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(LOCAL).map((f) => path.relative(LOCAL, f).split(path.sep).join('/')).filter((f) => !f.endsWith('.map'));
let same = 0;
const differ = [];
for (const rel of files) {
  const local = fs.readFileSync(path.join(LOCAL, rel));
  const r = await fetch(`${SITE}/app/${rel}`);
  if (!r.ok) { differ.push(`${rel}: not on the live site (HTTP ${r.status})`); continue; }
  const live = Buffer.from(await r.arrayBuffer());
  if (sha(local) === sha(live)) same++;
  else differ.push(`${rel}: live ${sha(live).slice(0, 12)}, yours ${sha(local).slice(0, 12)}`);
}
const index = (await get(`${SITE}/app/index.html`)).toString('utf8');
for (const m of index.matchAll(/\/app\/(assets\/[^"']+)/g)) if (!files.includes(m[1])) differ.push(`live index.html loads ${m[1]}, which your build does not have`);
const seen = { size: files.length };
console.log(`${same} of ${seen.size} files of your build are identical on the live site.`);
if (differ.length) {
  console.log('Different:\n  ' + differ.join('\n  '));
  process.exit(1);
}
