// Tests the package as a user gets it: builds packages/zcash/npm, packs it, installs the tarball into an empty folder
// and runs the published API from there, offline. Catches a missing file, a broken export map or an import that only
// resolves inside this repository.
//   node packages/zcash/scripts/pack-test.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.join(import.meta.dirname, '..');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

run('node', [path.join(HERE, 'scripts/build-npm.mjs')], HERE);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zecdoor-zcash-pack-'));
try {
  const tgz = run('npm', ['pack', '--silent', '--pack-destination', dir], path.join(HERE, 'npm')).trim().split('\n').at(-1);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"pack-test","private":true,"type":"module"}');
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', `./${tgz}`], dir);

  const files = run('tar', ['-tzf', path.join(dir, tgz)], dir).split('\n').filter(Boolean);
  for (const f of ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/worker.js', 'package/dist/wasm/zecdoor_wasm_bg.wasm', 'package/README.md', 'package/LICENSE', 'package/examples/node-basics.mjs'])
    if (!files.includes(f)) throw new Error(`missing from the tarball: ${f}`);
  if (files.some((f) => /\.(map|ts)$/.test(f) && !f.endsWith('.d.ts'))) throw new Error('source maps or .ts sources in the tarball');

  fs.writeFileSync(
    path.join(dir, 'check.mjs'),
    `import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as z from '@zecdoor/zcash';
await z.loadZcashWasm(await readFile(new URL(import.meta.resolve('@zecdoor/zcash/zecdoor_wasm_bg.wasm'))));
const ua = 'u1c5zssk2r6nasyar5amt5pw3szaes8h5wmer3qsaqkc2j6kjcae2lu95ycle3r8vvcdvpyfm7pdnx7624ckp7h5uwfa72l8y54cf4gu8m';
assert.equal(z.inspectAddress(ua, 'main').ok, true);
assert.equal(z.inspectAddress('t1J5WT7CwfJy7WJaMkYweYT2JUnSebbVRz4', 'main').reason, 'transparent_address');
const w = z.newWallet('main', 3_507_000);
assert.equal(w.mnemonic.split(' ').length, 24);
assert.equal(z.isValidMnemonic(w.mnemonic), true);
assert.equal(z.ufvkFromMnemonic(w.mnemonic, 'main'), w.ufvk);
const a3 = z.addressAt(w.ufvk, 'main', 3);
assert.deepEqual({ ...z.addressOwner(w.ufvk, 'main', a3) }, { belongs: true, scope: 'external', index: 3, reason: 'ok' });
assert.equal(z.addressOwner(w.ufvk, 'main', ua).belongs, false);
for (const f of ['scanRange', 'findArrival', 'GrpcWebSource']) assert.equal(typeof z[f], 'function', f);
assert.equal(z.MAINNET_GRPC_WEB, 'https://zjs.zec.rocks/mainnet');
console.log('ok');
`,
  );
  const out = run('node', ['check.mjs'], dir).trim();
  if (out !== 'ok') throw new Error(out);
  console.log(`Pack test passed: ${tgz}, ${files.length} files, installed and used from an empty folder.`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
