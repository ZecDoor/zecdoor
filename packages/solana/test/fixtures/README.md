# Fixtures

- `quote_*.json`: real signed 1Click quotes, taken from `GET /v0/status` for mainnet Solana ZEC → ZEC
  swaps made by other apps on 4 Oct 2026 (deposit address prefix in the file name).
  `/v0/status` does not echo `quoteWaitingTimeMs`, which 1Click signs. Three of these quotes were
  requested with `quoteWaitingTimeMs: 3000`; that field is restored here so the signature verifies
  (it fails without it, with both our code and the 1Click SDK).
- `jup_quote.json`, `jup_swap_ix.json`: a live Jupiter ExactOut quote (SOL → 100,000 zat of Solana ZEC)
  and its swap instructions for wallet `3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5`, 5 Oct 2026.
- `jup_alts.json`: the contents of the two lookup tables that swap uses, read from mainnet the same day.
