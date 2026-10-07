// Runs in Node 20+: node examples/node-basics.mjs
// Address checks, a new wallet's viewing key and addresses, and two read-only lightwalletd lookups.
import { readFile } from 'node:fs/promises';
import { addressAt, GrpcWebSource, inspectAddress, loadZcashWasm, MAINNET_GRPC_WEB, newWallet } from '@zecdoor/zcash';

// In Node, hand the engine its bytes. In a browser with a bundler, call loadZcashWasm() with no argument.
await loadZcashWasm(await readFile(new URL(import.meta.resolve('@zecdoor/zcash/zecdoor_wasm_bg.wasm'))));

// 1. Can NEAR Intents (or anyone) pay this address into the shielded pool?
for (const a of [
  'u1c5zssk2r6nasyar5amt5pw3szaes8h5wmer3qsaqkc2j6kjcae2lu95ycle3r8vvcdvpyfm7pdnx7624ckp7h5uwfa72l8y54cf4gu8m',
  't1J5WT7CwfJy7WJaMkYweYT2JUnSebbVRz4',
  'not an address',
]) {
  const r = inspectAddress(a, 'main');
  console.log(`${a.slice(0, 12)}…  ok=${r.ok}  reason=${r.reason}  receivers=${r.receivers.join(',') || '-'}`);
}

// 2. A new wallet. The 24 words are returned to you once: show them to the user and never store them.
//    (This example does not print them.)
const w = newWallet('main', 3_507_000);
console.log('viewing key:', w.ufvk.slice(0, 16) + '…');
console.log('address 0:  ', addressAt(w.ufvk, 'main', 0).slice(0, 24) + '…');
console.log('address 1:  ', addressAt(w.ufvk, 'main', 1).slice(0, 24) + '…', '(a new one for every payment)');

// 3. Read-only lookups on lightwalletd over gRPC-web (zec.rocks).
const lwd = new GrpcWebSource(MAINNET_GRPC_WEB);
console.log('chain tip:  ', await lwd.latestHeight());
const txid = '2fac74310c294c306f56bb9d60891af9d0f8f2ff9c4244f77e1939cf7df206d6'; // ZecDoor's first mainnet move
console.log('tx block:   ', await lwd.transactionHeight(txid));
