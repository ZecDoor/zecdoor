# ZecDoor

Move the ZEC you hold on Solana into a shielded Zcash wallet you control — with one signature in Phantom, even when your
balance is below the bridge minimum.

- **Non-custodial.** Your wallet sends to a NEAR Intents deposit address; NEAR Intents pays your shielded address. ZecDoor
  never holds funds and never sees keys.
- **Top-up for small balances.** A Jupiter exact-output swap fills the gap to the bridge minimum inside the same
  transaction. On 5 Oct 2026, 65.1% of non-empty Solana ZEC token accounts were below it
  ([script](scripts/stats/solana-zec-holders.mjs), [snapshot](docs/stats-2026-10-05.json)).
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

## Security model

- Transactions are built in the browser and may contain only the instructions listed in
  [security.mdx](apps/docs/content/docs/security.mdx); the rules are in
  [`packages/solana/src/allowlist.ts`](packages/solana/src/allowlist.ts) and its tests in
  [`allowlist.test.ts`](packages/solana/test/allowlist.test.ts).
- The app's Content Security Policy ([`deploy/site/_headers`](deploy/site/_headers)) lists every service it can reach.
- The server stores per-day totals only; see [`apps/server/src/counter.ts`](apps/server/src/counter.ts) and its tests.

Report vulnerabilities privately: see `/.well-known/security.txt` on the live site.

## Licence

MIT. See [LICENSE](LICENSE). Routing by NEAR Intents 1Click; top-up swaps by Jupiter (Metis). Not affiliated with
Phantom, NEAR, Jupiter, the Zcash Foundation or Electric Coin Co.
