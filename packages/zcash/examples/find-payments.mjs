// Finds Orchard and Ironwood payments to a viewing key in a block range, in Node 20+.
//   ZCASH_UFVK=uview1… FROM=3507530 TO=3507545 node examples/find-payments.mjs
// The viewing key is read from the environment and sent nowhere: lightwalletd only sees which blocks you ask for.
import { readFile } from 'node:fs/promises';
import { GrpcWebSource, loadZcashWasm, MAINNET_GRPC_WEB, scanRange } from '@zecdoor/zcash';

const { ZCASH_UFVK: ufvk, FROM, TO } = process.env;
if (!ufvk || !FROM || !TO) {
  console.error('Set ZCASH_UFVK, FROM and TO.');
  process.exit(1);
}
await loadZcashWasm(await readFile(new URL(import.meta.resolve('@zecdoor/zcash/zecdoor_wasm_bg.wasm'))));

const found = await scanRange({
  ufvk,
  network: 'main',
  source: new GrpcWebSource(MAINNET_GRPC_WEB),
  from: Number(FROM),
  to: Number(TO),
  onProgress: (h) => process.stderr.write(`\rblock ${h}`),
});
process.stderr.write('\n');
for (const f of found) console.log(`${f.pool} ${(f.value / 1e8).toFixed(8)} ZEC  block ${f.height}  tx ${f.txid}  address index ${f.index}  ${f.scope}`);
if (!found.length) console.log('No payments to this key in that range.');
