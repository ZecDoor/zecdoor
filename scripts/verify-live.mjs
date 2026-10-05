#!/usr/bin/env node
// Compares the app as deployed with the app you just built from this repository, file by file.
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

// Every file the live app loads: index.html, then everything it references, then what those reference.
const queue = ['index.html'];
const seen = new Set();
let same = 0;
const differ = [];
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const live = await get(`${SITE}/app/${rel}`);
  const localPath = path.join(LOCAL, rel);
  const local = fs.existsSync(localPath) ? fs.readFileSync(localPath) : null;
  if (local && sha(local) === sha(live)) same++;
  else differ.push(`${rel}: live ${sha(live).slice(0, 12)}, local ${local ? sha(local).slice(0, 12) : 'missing'}`);
  if (/\.(html|js|css)$/.test(rel)) {
    for (const m of live.toString('utf8').matchAll(/(?:\/app\/|\.\/|")(assets\/[\w.@-]+\.(?:js|css|wasm|woff2|svg|webp|png))/g)) queue.push(m[1]);
  }
}
console.log(`${same} of ${seen.size} files identical to your build.`);
if (differ.length) {
  console.log('Different:\n  ' + differ.join('\n  '));
  process.exit(1);
}
