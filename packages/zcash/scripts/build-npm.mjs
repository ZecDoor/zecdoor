// Builds the publishable npm package into packages/zcash/npm/: compiled JS and types from src/, with the
// WebAssembly engine (crates/zecdoor-wasm/pkg, built by scripts/build-wasm.sh) bundled inside, so the package
// has no dependencies. Publish with: npm publish packages/zcash/npm --access public
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.join(import.meta.dirname, '..');
const ROOT = path.join(HERE, '../..');
const OUT = path.join(HERE, 'npm');
const WASM = path.join(ROOT, 'crates/zecdoor-wasm/pkg');
const src = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

for (const f of ['zecdoor_wasm.js', 'zecdoor_wasm.d.ts', 'zecdoor_wasm_bg.wasm', 'zecdoor_wasm_bg.wasm.d.ts'])
  if (!fs.existsSync(path.join(WASM, f))) throw new Error(`missing ${f}: run ./scripts/build-wasm.sh first`);

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync('npx', ['tsc', '-p', 'tsconfig.npm.json'], { cwd: HERE, stdio: 'inherit' });

const dist = path.join(OUT, 'dist');
fs.mkdirSync(path.join(dist, 'wasm'));
for (const f of ['zecdoor_wasm.js', 'zecdoor_wasm.d.ts', 'zecdoor_wasm_bg.wasm', 'zecdoor_wasm_bg.wasm.d.ts'])
  fs.copyFileSync(path.join(WASM, f), path.join(dist, 'wasm', f));

// The workspace resolves 'zecdoor-wasm' as a linked package; the published package carries it inside.
for (const f of fs.readdirSync(dist).filter((f) => /\.(js|d\.ts)$/.test(f))) {
  const p = path.join(dist, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll("from 'zecdoor-wasm'", "from './wasm/zecdoor_wasm.js'"));
}
const left = fs.readdirSync(dist).filter((f) => fs.statSync(path.join(dist, f)).isFile() && fs.readFileSync(path.join(dist, f), 'utf8').includes("'zecdoor-wasm'"));
if (left.length) throw new Error(`unresolved zecdoor-wasm import in ${left.join(', ')}`);

fs.cpSync(path.join(HERE, 'examples'), path.join(OUT, 'examples'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'README.md'), path.join(OUT, 'README.md'));
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(OUT, 'LICENSE'));

const pkg = {
  name: '@zecdoor/zcash',
  version: src.version,
  description:
    'Zcash in the browser, view-only: new 24-word wallets, Orchard viewing keys and fresh addresses, address checks, and finding incoming Orchard and Ironwood notes over lightwalletd gRPC-web. Rust compiled to WebAssembly. Cannot spend.',
  license: 'MIT',
  type: 'module',
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './worker': { types: './dist/worker.d.ts', default: './dist/worker.js' },
    './zecdoor_wasm_bg.wasm': './dist/wasm/zecdoor_wasm_bg.wasm',
  },
  files: ['dist', 'examples', 'README.md', 'LICENSE'],
  sideEffects: ['./dist/worker.js'],
  engines: { node: '>=20' },
  repository: { type: 'git', url: 'git+https://github.com/ZecDoor/zecdoor.git', directory: 'packages/zcash' },
  homepage: 'https://github.com/ZecDoor/zecdoor/tree/main/packages/zcash#readme',
  bugs: 'https://github.com/ZecDoor/zecdoor/issues',
  keywords: ['zcash', 'orchard', 'ironwood', 'shielded', 'viewing-key', 'unified-address', 'lightwalletd', 'wasm', 'browser'],
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`Built ${pkg.name}@${pkg.version} in ${path.relative(ROOT, OUT)}`);
