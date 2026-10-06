// Reproduces the holder numbers we publish, from chain state and live quotes. Read-only.
// Usage: node scripts/stats/solana-zec-holders.mjs [rpc] > docs/stats-<date>.json
//   rpc: one that allows getProgramAccounts (api.mainnet-beta.solana.com from a server, or
//   public.rpc.solanavibestation.com). The response is about 90 MB.
//
// Three tiers of non-empty token accounts:
//   above:    at or above the bridge minimum: a plain move.
//   worth:    below the minimum but worth more than the fixed costs of moving it with our top-up.
//   dust:     worth less than those costs: moving it costs more than it is worth.
// Fixed costs of a move (all read live below): the bridge's payout fee as quoted (a ceiling), the
// deposit address's token account rent and the Solana fee (in SOL, converted at NEAR Intents' prices),
// our 0.25% of the minimum, and the top-up swap's 1% slippage bound on what it buys.
// Each tier is split by owner: a wallet (an address on the ed25519 curve) or a program/pool account
// (off-curve). Token accounts are not people: one person can hold several.

import { PublicKey } from '@solana/web3.js';

const RPC = process.argv[2] ?? 'https://public.rpc.solanavibestation.com';
const MINT = 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS';
const ONE_CLICK = 'https://1click.chaindefuser.com/v0';
const ASSET = { zec: 'nep141:zec.omft.near', sol: 'nep141:sol.omft.near', solZec: '1cs_v1:sol:spl:A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS' };
const FEE_RECIPIENT = '0b419bed99105b07bdcdd9b9f7a6b549fd9d1aab5ac062adbd3725cd6be24a56';
const OUR_FEE_BPS = 25n;
const TX_FEE_LAMPORTS = 15_000n; // base fee plus our priority fee (apps/app/src/lib/solana.ts)
const SLIPPAGE_BPS = 100n; // the top-up's Jupiter slippage bound
// Public, Orchard-only test address of this project, only used to ask for a dry quote.
const QUOTE_RECIPIENT = 'u1c5zssk2r6nasyar5amt5pw3szaes8h5wmer3qsaqkc2j6kjcae2lu95ycle3r8vvcdvpyfm7pdnx7624ckp7h5uwfa72l8y54cf4gu8m';
const QUOTE_REFUND = '3QFJWVEk6tpf52gtk3saAP1nkuci6GRMNHx72etsi67T';

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
};

/** The bridge minimum with our fee and the quoted payout fee, from a dry 1Click quote. */
async function bridgeTerms() {
  const body = (amount) => ({
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: ASSET.solZec,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: ASSET.zec,
    amount: String(amount),
    refundTo: QUOTE_REFUND,
    refundType: 'ORIGIN_CHAIN',
    recipient: QUOTE_RECIPIENT,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 3_600_000).toISOString(),
    appFees: [{ recipient: FEE_RECIPIENT, fee: Number(OUR_FEE_BPS) }],
  });
  const post = (amount) => fetch(`${ONE_CLICK}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(amount)) }).then((r) => r.json());
  const tooLow = await post(1);
  const minimum = BigInt(String(tooLow.message ?? '').match(/at least (\d+)/)?.[1] ?? NaN);
  const quote = await post(minimum);
  return { minimum, withdrawFee: BigInt(quote.quote.withdrawFee), message: tooLow.message };
}

async function prices() {
  const tokens = await fetch(`${ONE_CLICK}/tokens`).then((r) => r.json());
  const p = (id) => tokens.find((t) => t.assetId === id)?.price;
  return { zec: p(ASSET.zec), sol: p(ASSET.sol) };
}

const [terms, px, rent, accounts] = await Promise.all([
  bridgeTerms(),
  prices(),
  rpc('getMinimumBalanceForRentExemption', [165]).then(BigInt),
  rpc('getProgramAccounts', [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    { encoding: 'base64', dataSlice: { offset: 32, length: 40 }, filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: MINT } }] },
  ]),
]);

// Fixed costs of one move, in zat.
const solToZat = (lamports) => (lamports * BigInt(Math.round(px.sol * 1e6))) / BigInt(Math.round(px.zec * 1e6)) / 10n; // lamports(1e9) → zat(1e8)
const costs = {
  bridgePayoutFeeCeiling: terms.withdrawFee,
  depositAccountAndSolanaFee: solToZat(rent + TX_FEE_LAMPORTS),
  ourFeeOnMinimum: (terms.minimum * OUR_FEE_BPS) / 10_000n,
  topUpSlippageBound: (terms.minimum * SLIPPAGE_BPS) / 10_000n,
};
const worthFrom = Object.values(costs).reduce((a, b) => a + b, 0n);

const tiers = { above: [], worth: [], dust: [] };
let empty = 0;
for (const r of accounts) {
  const b = Buffer.from(r.account.data[0], 'base64');
  const amount = b.readBigUInt64LE(32);
  if (amount === 0n) {
    empty++;
    continue;
  }
  const wallet = PublicKey.isOnCurve(b.subarray(0, 32));
  const tier = amount >= terms.minimum ? 'above' : amount >= worthFrom ? 'worth' : 'dust';
  tiers[tier].push({ amount, wallet });
}

const zec = (zat) => Number(zat) / 1e8;
const sum = (xs) => xs.reduce((s, x) => s + x.amount, 0n);
const summary = (xs) => {
  const w = xs.filter((x) => x.wallet);
  return {
    accounts: xs.length,
    zec: zec(sum(xs)),
    walletOwned: { accounts: w.length, zec: zec(sum(w)) },
    programOwned: { accounts: xs.length - w.length, zec: zec(sum(xs) - sum(w)) },
  };
};
const nonEmpty = tiers.above.length + tiers.worth.length + tiers.dust.length;

console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      sources: {
        accounts: `getProgramAccounts on ${RPC}, mint ${MINT}, SPL Token program`,
        minimumAndPayoutFee: `1Click dry quote: "${terms.message}"; quoted withdrawFee at the minimum`,
        prices: `${ONE_CLICK}/tokens`,
        rent: 'getMinimumBalanceForRentExemption(165)',
      },
      prices: { zecUsd: px.zec, solUsd: px.sol },
      bridgeMinimumZat: Number(terms.minimum),
      worthMovingFromZat: Number(worthFrom),
      worthMovingFromUsd: Number((zec(worthFrom) * px.zec).toFixed(2)),
      fixedCostsZat: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, Number(v)])),
      tokenAccounts: accounts.length,
      empty,
      nonEmpty,
      above: summary(tiers.above),
      belowButWorthMoving: summary(tiers.worth),
      dust: summary(tiers.dust),
      shares: {
        above: `${((tiers.above.length / nonEmpty) * 100).toFixed(1)}%`,
        belowButWorthMoving: `${((tiers.worth.length / nonEmpty) * 100).toFixed(1)}%`,
        dust: `${((tiers.dust.length / nonEmpty) * 100).toFixed(1)}%`,
      },
      zecTotal: zec(sum([...tiers.above, ...tiers.worth, ...tiers.dust])),
    },
    null,
    2,
  ),
);
