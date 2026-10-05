# zecdoor-wasm

Browser-side Zcash code for ZecDoor, compiled to WebAssembly.

**What it does:**
- Makes a 24-word seed. Keys are standard ZIP 32 (`use_qsk = false`), so the seed restores in Zodl and Zkool.
- Derives an Orchard-only viewing key, and an Orchard-only unified address at any diversifier index. ZecDoor uses a new index for every move.
- Checks a pasted address. It accepts only a unified address with an Orchard receiver on the expected network, which is what NEAR Intents 1Click can pay into Ironwood. Otherwise it gives the reason.
- Finds incoming Orchard and Ironwood notes in compact blocks, using the viewing key.

**What it cannot do:** build, sign or send a Zcash transaction. The seed and spending key exist only inside `ufvk_from_mnemonic` and are wiped before it returns.

## Build

```
./scripts/build-wasm.sh   # from the repo root
```

The build needs a clang that can target wasm32, because one C dependency (`secp256k1-sys`) requires it. On macOS the script downloads wasi-sdk once into `~/.cache/zecdoor`.

## Tests

```
cargo test                                         # unit tests + ZIP 316 vectors
pnpm --filter @zecdoor/zcash test                  # WASM through the TypeScript API
NETWORK_TESTS=1 pnpm --filter @zecdoor/zcash test  # read-only mainnet scan via zec.rocks
REGTEST=1 ZEBRAD=… ZAINOD=… DEVTOOL=… pnpm --filter @zecdoor/zcash test regtest
```

**What they cover:**
- **ZIP 316 vectors:** the derived Orchard receivers match the official test vectors byte for byte. The vectors are [`unified_address.json`](https://github.com/zcash/zcash-test-vectors/blob/master/test-vectors/json/unified_address.json), copied into `tests/vectors/`.
- **Regtest:** zebrad, zainod and zcash-devtool built with `regtest_support`. A payment goes to our index-4242 address, our scanner finds the Ironwood note, and zcash-devtool restores our 24 words and shows the balance. zcash-devtool uses the same `zcash_client_backend` and `zcash_client_sqlite` versions as Zodl's SDK.
