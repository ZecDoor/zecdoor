# @zecdoor/zcash

Zcash in the browser, view-only. The Rust Zcash libraries compiled to WebAssembly, with a small TypeScript API and a
lightwalletd client that needs only `fetch`. It is the engine of [ZecDoor](https://zecdoor.0xo.in), published so other
Zcash builders can use it.

**It can:**

- Make a new 24-word wallet (BIP 39, standard ZIP 32 keys), so the words restore in Zodl and Zkool.
- Derive the wallet's Orchard-only viewing key, and a fresh Orchard-only unified address at any index.
- Check an address: it accepts only a unified address with an Orchard receiver on the expected network, and otherwise
  says why (transparent, Sapling-only, TEX, Sprout, wrong network, invalid).
- Find incoming Orchard and Ironwood payments ("notes") to a viewing key in compact blocks from lightwalletd, over
  gRPC-web, in a page or a Web Worker.
- Look up which block holds a transaction.

**It cannot** build, sign or send a Zcash transaction. The seed and spending key exist only inside the call that turns
the words into a viewing key, and are wiped before it returns.

The engine is 659,742 bytes of WebAssembly (351 KB as served with brotli). It has not had an independent security audit.

## Install

```sh
npm install @zecdoor/zcash
```

No dependencies: the WebAssembly is inside the package.

## Use

```ts
import { addressAt, inspectAddress, loadZcashWasm, newWallet } from '@zecdoor/zcash';

await loadZcashWasm(); // in a browser with a bundler (Vite, webpack 5, Next): finds the .wasm by itself

// A new wallet. Show the 24 words to the user once, have them write the words down, and never store them.
const { mnemonic, ufvk, birthday } = newWallet('main', currentHeight - 10);

// A new address for every payment; the viewing key sees all of them.
const address = addressAt(ufvk, 'main', 0);

// Is a pasted address shielded and payable?
const r = inspectAddress('t1J5WT7CwfJy7WJaMkYweYT2JUnSebbVRz4', 'main');
// { ok: false, reason: 'transparent_address', kind: 'transparent', ... }
```

In Node, pass the engine's bytes:

```ts
import { readFile } from 'node:fs/promises';
await loadZcashWasm(await readFile(new URL(import.meta.resolve('@zecdoor/zcash/zecdoor_wasm_bg.wasm'))));
```

### Find a payment

```ts
import { findArrival, GrpcWebSource, MAINNET_GRPC_WEB, scanRange } from '@zecdoor/zcash';

const source = new GrpcWebSource(MAINNET_GRPC_WEB); // zec.rocks; any lightwalletd behind a gRPC-web proxy works
const to = await source.latestHeight();

// Every payment to the key in a range:
const notes = await scanRange({ ufvk, network: 'main', source, from: birthday, to });

// Or the one payment you are waiting for: to address index 0, at least 100,320 zatoshis.
const note = await findArrival({ ufvk, network: 'main', source, from: birthday, to, index: 0, minValue: 100_320 });
// { height, txid, pool: 'ironwood' | 'orchard', value, scope, index } or null
```

The viewing key never leaves your code. lightwalletd sees your IP address and which block ranges you ask for.

To scan without blocking the page, run it in a Web Worker. Make a two-line worker file:

```ts
// scan.worker.ts
import '@zecdoor/zcash/worker';
```

Start it with `new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' })`, post
`{ id, type: 'arrival', proxy: MAINNET_GRPC_WEB, ufvk, network, from, to, index, minValue }`, and listen for `progress`
messages, then one `result` or `error` (types `ArrivalRequest` and `WorkerReply`). The WebAssembly is single-threaded,
so it needs no `SharedArrayBuffer` and runs in wallet in-app browsers.

### Which block holds a transaction

```ts
await new GrpcWebSource(MAINNET_GRPC_WEB).transactionHeight('2fac74310c294c306f56bb9d60891af9d0f8f2ff9c4244f77e1939cf7df206d6');
// 3507539, or null if lightwalletd does not know it. Takes the ID as explorers show it.
```

## Examples

- [`examples/node-basics.mjs`](examples/node-basics.mjs): address checks, a new wallet's viewing key and addresses,
  the chain tip, and a transaction's block.
- [`examples/find-payments.mjs`](examples/find-payments.mjs): payments to a viewing key in a block range.

## API

| Function | What it does |
|---|---|
| `loadZcashWasm(bytes?)` | Loads the engine once. Call before anything else. |
| `newWallet(network, birthday)` | `{ mnemonic, ufvk, birthday }` for a new 24-word wallet. |
| `isValidMnemonic(phrase)` | True for a valid 24-word English BIP 39 phrase. |
| `ufvkFromMnemonic(phrase, network)` | The Orchard-only unified full viewing key (`uview1…`) of account 0. |
| `addressAt(ufvk, network, index)` | The Orchard-only unified address at `index`. |
| `inspectAddress(address, network)` | `{ ok, reason, kind, network, receivers }`. |
| `scanRange(options)` | Every note to the key in `from..=to`. |
| `findArrival(options)` | The note to `index` worth at least `minValue` (and in `txid`, if given), or null. |
| `GrpcWebSource(url)` | lightwalletd over gRPC-web: `latestHeight()`, `blocks(from, to)`, `transactionHeight(txid)`. |

`network` is `'main'`, `'test'` or `'regtest'`.

## How it is tested

In the [ZecDoor repository](https://github.com/ZecDoor/zecdoor): the derived Orchard receivers match the official ZIP 316
test vectors byte for byte; on a local regtest network, a payment to one of its addresses is found by the scanner and
the 24 words restored in zcash-devtool show the same balance; and on mainnet it found ZecDoor's first move
([proof](https://zecdoor.0xo.in/app/#/proof)).

Built from `crates/zecdoor-wasm` with `zcash_client_backend` 0.24, `zcash_keys` 0.16 and `orchard` 0.15.

## Licence

MIT
