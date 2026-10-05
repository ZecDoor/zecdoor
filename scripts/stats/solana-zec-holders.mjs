// Reproduces the landing page's holder numbers from chain state.
// Usage: node scripts/stats/solana-zec-holders.mjs [rpc]   (needs an RPC that allows getProgramAccounts)
const RPC = process.argv[2] ?? 'https://public.rpc.solanavibestation.com';
const MINT = 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS';
const MIN_WITH_FEE = 133_669n; // 1Click's suggested minimum with ZecDoor's 25 bps fee (5 Oct 2026)
const MIN_NO_FEE = 133_334n;

const res = await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getProgramAccounts',
    params: [
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      { encoding: 'base64', dataSlice: { offset: 64, length: 8 }, filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: MINT } }] },
    ],
  }),
});
const { result } = await res.json();
const amounts = result.map((r) => Buffer.from(r.account.data[0], 'base64').readBigUInt64LE(0));
const held = amounts.filter((a) => a > 0n);
const below = held.filter((a) => a < MIN_WITH_FEE);
const zec = (v) => Number(v.reduce((s, x) => s + x, 0n)) / 1e8;
console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      rpc: RPC,
      tokenAccounts: amounts.length,
      nonEmpty: held.length,
      belowMinimumWithFee: below.length,
      belowMinimumNoFee: held.filter((a) => a < MIN_NO_FEE).length,
      shareBelow: `${((below.length / held.length) * 100).toFixed(1)}%`,
      zecBelow: zec(below),
      zecTotal: zec(amounts),
    },
    null,
    2,
  ),
);
