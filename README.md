# ZecDoor

Move the ZEC you hold on Solana into a shielded Zcash wallet you control — with one signature in Phantom, even when your
balance is below the bridge minimum.

- **Non-custodial.** Your wallet sends to a NEAR Intents deposit address; NEAR Intents pays your shielded address. ZecDoor
  never holds funds and never sees keys.
- **Top-up for small balances.** A Jupiter exact-output swap fills the gap to the bridge minimum inside the same
  transaction, for balances worth more than a move costs; below that line (about $0.63 on 6 Oct 2026) the app says
  moving is not worth it. On 6 Oct 2026: 47,236 Solana ZEC accounts above the minimum, 17,647 below it but worth moving,
  73,312 dust ([script](scripts/stats/solana-zec-holders.mjs), [snapshot](docs/stats-2026-10-06.json)).
- **A first Zcash wallet, backed up properly.** 24 words made in the browser, a three-word check, and the birthday height
  for Zodl or Zkool. Only a viewing key is kept, on the device.
- **Proof of arrival.** NEAR Intents' signed quote, both transaction IDs, and the shielded note found by your own browser
  (WebAssembly trial decryption over lightwalletd).
- **Checked before you sign.** Every transaction passes an instruction allowlist and a live simulation before Phantom
  sees it. The allowlist tests block every build.

Docs: `/docs` on the live site (source in [`apps/docs/content/docs`](apps/docs/content/docs)). What stays public is
described plainly in [what-is-public.mdx](apps/docs/content/docs/what-is-public.mdx).

## Layout

| Path | What |
|---|---|
| [`crates/zecdoor-wasm`](crates/zecdoor-wasm) | Rust → WebAssembly: BIP-39 seed, Orchard-only viewing key, fresh unified addresses, address inspection, compact-block trial decryption (Orchard and Ironwood) |
| [`packages/zcash`](packages/zcash) | TypeScript wallet API and a fetch-only gRPC-web lightwalletd client; Web Worker for the arrival scan |
| [`packages/solana`](packages/solana) | NEAR Intents 1Click client and quote-signature verification, transaction builders (exit, top-up, buy), the instruction allowlist, simulation, fee self-test |
| [`apps/app`](apps/app) | The app (Vite + React), served at `/app` |
| [`apps/docs`](apps/docs) | The docs (Fumadocs), served at `/docs` |
| [`apps/server`](apps/server) | Cloudflare Worker: health, region, sanctions list, verified counter; serves the static site |
| [`scripts`](scripts) | WASM build, site build, holder statistics, mainnet test runner |

The landing page at `/` is built from a commercial template whose licence does not allow publishing its source, so it
lives in a separate private repository; only its built output is deployed.

## Run it

Requirements: Node 22+, pnpm 9, Rust with the `wasm32-unknown-unknown` target. On macOS the WASM build downloads wasi-sdk's
clang (needed by `secp256k1-sys`).

```sh
pnpm install
pnpm build:wasm          # crates/zecdoor-wasm → pkg/
pnpm test                # unit tests; includes the allowlist suite
pnpm test:live           # adds read-only mainnet checks (dry quotes, simulations); sends nothing
pnpm test:rust           # Rust tests, including ZIP 316 vectors
pnpm --filter @zecdoor/app e2e   # every screen and state in Playwright, phone and desktop
pnpm --filter @zecdoor/app dev   # the app on http://localhost:5173/app/
```

Build the deployable site (needs the production domain for the anti-phishing notice):

```sh
VITE_DOMAIN=<domain> pnpm build:site     # → dist/site, served by apps/server (wrangler deploy)
```

## Verify the build

The app at `/app` is the part that builds and checks the transaction you sign. To check that what is live is this code:

1. See which commit the live site was built from: `https://zecdoor.0xo.in/build.json` (`commit`, and `dirty: false`).
2. Build the app from that commit and compare it with the live files:

   ```sh
   git clone https://github.com/ZecDoor/zecdoor && cd zecdoor
   git checkout <commit from build.json>
   pnpm install --frozen-lockfile
   pnpm build:wasm
   VITE_DOMAIN=zecdoor.0xo.in VITE_SOURCE_URL=https://github.com/ZecDoor/zecdoor pnpm --filter @zecdoor/app exec vite build
   node scripts/verify-live.mjs https://zecdoor.0xo.in
   ```

   The script downloads every file the live app loads and compares its SHA-256 with your build. The JavaScript, CSS and
   HTML depend only on the lockfile and Node; the WebAssembly file also depends on your Rust and clang versions, so it
   can differ when those differ. The versions used are pinned: Rust in [`rust-toolchain.toml`](rust-toolchain.toml), clang
   (wasi-sdk 34 on macOS) and wasm-pack (0.13.1) in [`scripts/build-wasm.sh`](scripts/build-wasm.sh), Node in `build.json`, pnpm in
   `package.json`. On Linux the script uses the system clang, so expect the `.wasm` file alone may differ there.
3. Check what the code allows you to sign: `pnpm test` runs the allowlist suite in
   [`allowlist.test.ts`](packages/solana/test/allowlist.test.ts), which also blocks every build.
4. In the browser, the review screen shows NEAR Intents' signed quote, and Phantom shows the transaction before you sign.

## Security model

- Transactions are built in the browser and may contain only the instructions listed in
  [security.mdx](apps/docs/content/docs/security.mdx); the rules are in
  [`packages/solana/src/allowlist.ts`](packages/solana/src/allowlist.ts) and its tests in
  [`allowlist.test.ts`](packages/solana/test/allowlist.test.ts).
- The app's Content Security Policy ([`deploy/site/_headers`](deploy/site/_headers)) lists every service it can reach.
- The server stores per-day totals only; see [`apps/server/src/counter.ts`](apps/server/src/counter.ts) and its tests.

Report vulnerabilities privately to jagadeesh26062002@gmail.com; see [SECURITY.md](SECURITY.md) (also `/.well-known/security.txt` on the live site).

## Licence

MIT. See [LICENSE](LICENSE). Routing by NEAR Intents 1Click; top-up swaps by Jupiter (Metis). Not affiliated with
Phantom, NEAR, Jupiter, the Zcash Foundation or Electric Coin Co.
