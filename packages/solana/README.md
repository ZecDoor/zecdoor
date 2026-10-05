# @zecdoor/solana

Builds the one Solana transaction a ZecDoor user signs, and proves it can only do what the
user asked.

| Move | What the transaction does | Size | Compute (simulated) |
|---|---|---|---|
| `exit` | Sends exactly the quoted Solana ZEC to the 1Click deposit address | 439 B | 15,423 CU |
| `topup` | Jupiter exact-output swap of the user's SOL into the user's own ZEC account, then the exit | 1,030 B | 147,488 CU |
| `buyUsdc` | Sends exactly the quoted USDC to the deposit address | 439 B | 15,423 CU |
| `buySol` | A plain SOL transfer of exactly the quoted lamports to the deposit address | 269 B | 450 CU |

Sizes and compute are from read-only mainnet simulations on 5 Oct 2026 (`pnpm test:live`).

## Pieces

- `oneclick.ts`: NEAR Intents 1Click client. `checkQuote` verifies 1Click's ed25519 signature
  (same construction as `@defuse-protocol/one-click-sdk-typescript` 0.1.26, cross-checked in tests),
  then the fields the signature does not cover: the app-fee rows and the request deadline.
- `allowlist.ts`: `checkTransaction` decodes every instruction (including Jupiter's route,
  using the account layout from the program's on-chain IDL) and refuses anything outside the
  list in the file header. `prepareMove` calls it before any transaction reaches the wallet.
- `build.ts`, `move.ts`: instruction builders and the quote → transaction composer.
- `simulate.ts`: read-only simulation that reports what the deposit address would receive.
- `fees.ts`: start-up self-test of the fee rows 1Click echoes (ours 25 of 25 bps on exits,
  25 of 50 bps on USDC/SOL buys, observed live 5 Oct 2026).

## Tests

```sh
pnpm test                 # offline: signatures, quote checks, allowlist
pnpm test:allowlist       # the build-blocking allowlist suite only
NETWORK_TESTS=1 pnpm test # adds live dry quotes and mainnet simulations (nothing is signed or sent)
```

`pnpm build` at the repo root runs the allowlist suite first and stops if it fails; CI does the same
before any other job.

Findings recorded while building this (5 Oct 2026):

- `/v0/status` does not echo `quoteWaitingTimeMs`, which 1Click signs, so a quote read back from
  status only verifies once that field is restored. ZecDoor keeps its own `/v0/quote` response.
- On a full quote the request `deadline` is not signed (the quote's `deadline` overwrites it in the
  signed object), so `checkQuote` compares it with what we sent.
- With a 25 bps fee, 1Click suggests a minimum of 133,669 zat; the lowest amount it accepted was
  133,345 zat (133,011 zat with no fee). ZecDoor uses the suggested figure.
