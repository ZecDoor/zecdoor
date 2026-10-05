// Network-level mocks for the e2e suite: Solana RPC, NEAR Intents 1Click, Jupiter, our API
// and Phantom's provider. The app runs its real code (quote checks, allowlist, simulation
// handling); only the outside world is replaced. Quotes are signed with a test key using the
// same hash construction as 1Click, and the app is told that key only in `--mode e2e`.

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import type { Page, Route } from '@playwright/test';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { ata, FEE_RECIPIENT, quoteHash, USDC_MINT, ZEC_MINT, type QuoteRequest, type QuoteResponse, type StatusResponse } from '@zecdoor/solana';
import fs from 'node:fs';
import path from 'node:path';

const FIX = path.join(import.meta.dirname, 'fixtures');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

/** The Jupiter fixture was captured for this wallet, so the mock user is this public address. */
export const OWNER = '3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5';
/** The project's own test wallet receiver (Orchard-only), public. */
export const TEST_UA = 'u1c5zssk2r6nasyar5amt5pw3szaes8h5wmer3qsaqkc2j6kjcae2lu95ycle3r8vvcdvpyfm7pdnx7624ckp7h5uwfa72l8y54cf4gu8m';
const NEAR_SHARE = '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd';

const secret = new Uint8Array(32).fill(42);
const QUOTE_KEY = 'ed25519:' + base58.encode(ed25519.getPublicKey(secret));

export interface Scenario {
  zec?: bigint;
  usdc?: bigint;
  sol?: bigint;
  hasZecAccount?: boolean;
  health?: { ok: boolean; paused: boolean; message?: string } | null;
  geo?: { allowed: boolean; topup: boolean; country?: string } | null;
  counter?: unknown;
  /** Status replies in order; the last one repeats. */
  statuses?: Array<(depositAddress: string, q: QuoteResponse) => StatusResponse>;
  /** Arrival the browser scan "finds" (by e2e seam), or null for not yet. */
  arrival?: { height: number; value: number } | null;
  zcashTip?: number;
  /** Phantom already trusts the site (silent reconnect). */
  trusted?: boolean;
  phantom?: boolean;
  /** Make the user reject in Phantom. */
  reject?: boolean;
  simulateErr?: unknown;
}

export interface Mocks {
  quotes: QuoteResponse[];
  signed: () => Promise<string[]>;
  counted: Array<Record<string, unknown>>;
}

const MIN: Record<string, bigint> = {
  '1cs_v1:sol:spl:A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS': 133_669n,
  'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near': 1_780_000n,
  'nep141:sol.omft.near': 14_800_000n,
};
const ZEC_USD = 133.47;
const SOL_USD = 230.1;

function tokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint): string {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1; // initialized
  return b.toString('base64');
}

const acct = (data: string, owner = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports = 2_039_280) => ({
  data: [data, 'base64'],
  executable: false,
  lamports,
  owner,
  rentEpoch: 18446744073709551615,
  space: Buffer.from(data, 'base64').length,
});

function makeQuote(req: QuoteRequest): QuoteResponse | { status: number; message: string } {
  const amount = BigInt(req.amount);
  const min = MIN[req.originAsset] ?? 0n;
  if (amount < min) return { status: 400, message: `Amount is too low for bridge, try at least ${min}` };
  const ours = req.appFees?.[0]?.fee ?? 0;
  const zecIn = req.originAsset.startsWith('1cs_v1');
  let gross: bigint;
  let usd: number;
  if (zecIn) {
    gross = amount;
    usd = (Number(amount) / 1e8) * ZEC_USD;
  } else if (req.originAsset.includes('sol-5ce3')) {
    usd = Number(amount) / 1e6;
    gross = BigInt(Math.floor((usd / ZEC_USD) * 1e8));
  } else {
    usd = (Number(amount) / 1e9) * SOL_USD;
    gross = BigInt(Math.floor((usd / ZEC_USD) * 1e8));
  }
  const out = (gross * BigInt(10_000 - ours)) / 10_000n - 32_000n;
  const appFees = zecIn
    ? [{ recipient: FEE_RECIPIENT, fee: ours }]
    : [
        { recipient: FEE_RECIPIENT, fee: ours / 2 },
        { recipient: NEAR_SHARE, fee: ours / 2 },
      ];
  const r: QuoteResponse = {
    timestamp: new Date().toISOString(),
    signature: '',
    correlationId: 'e2e-' + Math.random().toString(16).slice(2),
    quoteRequest: { ...req, appFees },
    quote: {
      amountIn: req.amount,
      amountInFormatted: zecIn ? String(Number(amount) / 1e8) : req.originAsset.includes('sol-5ce3') ? String(Number(amount) / 1e6) : String(Number(amount) / 1e9),
      amountInUsd: usd.toFixed(6),
      minAmountIn: req.amount,
      amountOut: out.toString(),
      amountOutFormatted: String(Number(out) / 1e8),
      amountOutUsd: ((Number(out) / 1e8) * ZEC_USD).toFixed(6),
      minAmountOut: ((out * 99n) / 100n).toString(),
      timeEstimate: 135,
      refundFee: '10048',
      withdrawFee: '32000',
      ...(req.dry
        ? {}
        : {
            depositAddress: Keypair.generate().publicKey.toBase58(),
            deadline: req.deadline,
            timeWhenInactive: req.deadline,
          }),
    },
  };
  r.signature = 'ed25519:' + base58.encode(ed25519.sign(new TextEncoder().encode(quoteHash(r)), secret));
  return r;
}

export const status = {
  pending: (): ((d: string, q: QuoteResponse) => StatusResponse) => (_d, q) => ({ status: 'PENDING_DEPOSIT', updatedAt: new Date().toISOString(), quoteResponse: q }),
  processing: (): ((d: string, q: QuoteResponse) => StatusResponse) => (_d, q) => ({
    status: 'PROCESSING',
    updatedAt: new Date().toISOString(),
    quoteResponse: q,
    swapDetails: { originChainTxHashes: [{ hash: 'deposit', explorerUrl: '' }] },
  }),
  success: (): ((d: string, q: QuoteResponse) => StatusResponse) => (_d, q) => ({
    status: 'SUCCESS',
    updatedAt: new Date().toISOString(),
    quoteResponse: q,
    swapDetails: {
      amountOut: q.quote.amountOut,
      destinationChainTxHashes: [{ hash: 'ac36529f67ca10144dcbbe4f5214fa3d41436d54b27568d1d5168801efe4a29a', explorerUrl: '' }],
    },
  }),
  refunded: (): ((d: string, q: QuoteResponse) => StatusResponse) => (_d, q) => ({
    status: 'REFUNDED',
    updatedAt: new Date().toISOString(),
    quoteResponse: q,
    swapDetails: {
      refundReason: 'AMOUNT_LESS_THAN_MIN_AMOUNT_OUT',
      refundedAmount: q.quote.amountIn,
      refundFee: '0',
      originChainTxHashes: [{ hash: '3pQzWq8yQ1yS9v1Pn5mPZb2sGx7Lz4oRkX2c8f3HjYt8kV9uB6dN1aE5rT7wQ2mL4pC9xZ3sD8fG1hJ6kL0tY8k', explorerUrl: '' }],
    },
  }),
};

export async function mock(page: Page, s: Scenario = {}): Promise<Mocks> {
  const owner = new PublicKey(OWNER);
  const zecAta = ata(ZEC_MINT, owner).toBase58();
  const usdcAta = ata(USDC_MINT, owner).toBase58();
  const quotes: QuoteResponse[] = [];
  const counted: Array<Record<string, unknown>> = [];
  const statusCalls = new Map<string, number>();
  const zec = s.zec ?? 8_740_000n;
  const usdc = s.usdc ?? 97_070_000n;
  const sol = s.sol ?? 1_391_559_960n;
  const hasZec = s.hasZecAccount ?? true;
  const alts: Record<string, unknown> = {
    NAQxBNqDYMASwX8FgXj56AZBSz2yvyCSKSjKFGupNjJ: read('alt_NAQxBNqDYMASwX8FgXj56AZBSz2yvyCSKSjKFGupNjJ.json'),
    '6PV6cFpiGrQbJbAEhyLkDMtHgJbaEZbgrwGJdXWwWFtZ': read('alt_6PV6cFpiGrQbJbAEhyLkDMtHgJbaEZbgrwGJdXWwWFtZ.json'),
  };
  const ctx = (value: unknown) => ({ context: { slot: 453_460_000, apiVersion: '4.3.0' }, value });

  const account = (k: string) => {
    if (k === zecAta) return hasZec ? acct(tokenAccount(ZEC_MINT, owner, zec)) : null;
    if (k === usdcAta) return acct(tokenAccount(USDC_MINT, owner, usdc));
    if (alts[k]) return alts[k];
    return null;
  };

  const rpc = async (route: Route) => {
    const body = route.request().postDataJSON() as { id: number; method: string; params: unknown[] };
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
    switch (body.method) {
      case 'getMultipleAccounts':
        return reply(ctx((body.params[0] as string[]).map(account)));
      case 'getAccountInfo':
        return reply(ctx(account(body.params[0] as string)));
      case 'getMinimumBalanceForRentExemption':
        return reply((body.params[0] as number) === 165 ? 1_488_440 : 650_240);
      case 'getBalance':
        return reply(ctx(Number(sol)));
      case 'getLatestBlockhash':
        return reply(ctx({ blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: 431_000_000 }));
      case 'simulateTransaction': {
        const q = quotes.at(-1)!;
        const watch = (body.params[1] as { accounts: { addresses: string[] } }).accounts.addresses[0]!;
        const amountIn = BigInt(q.quote.amountIn);
        const dep = new PublicKey(q.quote.depositAddress!);
        const isSol = watch === dep.toBase58();
        const mint = q.quoteRequest.originAsset.includes('sol-5ce3') ? USDC_MINT : ZEC_MINT;
        const after = isSol ? acct('', '11111111111111111111111111111111', Number(amountIn)) : acct(tokenAccount(mint, dep, amountIn));
        return reply(
          ctx({
            err: s.simulateErr ?? null,
            logs: s.simulateErr ? ['Program log: Error: insufficient lamports'] : ['Program log: ok'],
            accounts: [after],
            unitsConsumed: 15_423,
            returnData: null,
            innerInstructions: null,
            replacementBlockhash: null,
          }),
        );
      }
      default:
        throw new Error(`e2e mock: unhandled RPC method ${body.method}`);
    }
  };
  await page.route('https://rpc.solanatracker.io/**', rpc);
  await page.route('https://public.rpc.solanavibestation.com/**', rpc);

  await page.route('https://1click.chaindefuser.com/v0/quote', async (route) => {
    const req = route.request().postDataJSON() as QuoteRequest;
    const r = makeQuote(req);
    if ('status' in r && 'message' in r) return route.fulfill({ status: r.status, json: { message: r.message } });
    if (!req.dry) quotes.push(r);
    return route.fulfill({ json: r });
  });
  await page.route('https://1click.chaindefuser.com/v0/status*', async (route) => {
    const dep = new URL(route.request().url()).searchParams.get('depositAddress')!;
    const q = quotes.find((x) => x.quote.depositAddress === dep);
    if (!q) return route.fulfill({ status: 404, json: { message: 'not found' } });
    const n = statusCalls.get(dep) ?? 0;
    statusCalls.set(dep, n + 1);
    const seq = s.statuses ?? [status.processing(), status.success()];
    const f = seq[Math.min(n, seq.length - 1)]!;
    return route.fulfill({ json: f(dep, q) });
  });
  await page.route('https://1click.chaindefuser.com/v0/deposit/submit', (route) => route.fulfill({ json: {} }));
  await page.route('https://1click.chaindefuser.com/v0/tokens', (route) =>
    route.fulfill({
      json: [
        { assetId: 'nep141:zec.omft.near', decimals: 8, price: ZEC_USD, symbol: 'ZEC' },
        { assetId: 'nep141:sol.omft.near', decimals: 9, price: SOL_USD, symbol: 'SOL' },
        { assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', decimals: 6, price: 1, symbol: 'USDC' },
      ],
    }),
  );

  await page.route('https://lite-api.jup.ag/swap/v1/quote*', (route) => route.fulfill({ json: read('jup_quote.json') }));
  await page.route('https://lite-api.jup.ag/swap/v1/swap-instructions', (route) => route.fulfill({ json: read('jup_swap_ix.json') }));

  await page.route('**/api/health', (route) =>
    s.health === null ? route.abort() : route.fulfill({ json: { ok: true, paused: false, checkedAt: new Date().toISOString(), ...(s.health ?? {}) } }),
  );
  await page.route('**/api/geo', (route) => (s.geo === null ? route.abort() : route.fulfill({ json: s.geo ?? { allowed: true, topup: true, country: 'DE' } })));
  await page.route('**/api/sanctions', (route) => route.fulfill({ json: { updatedAt: '2026-10-05', solana: [] } }));
  await page.route('**/api/counter', (route) => (s.counter ? route.fulfill({ json: s.counter }) : route.abort()));
  await page.route('**/api/count', async (route) => {
    counted.push(route.request().postDataJSON());
    return route.fulfill({ json: { counted: true } });
  });
  // No other network: anything unexpected fails loudly.
  await page.route(/^https:\/\/(?!localhost).*/, (route) => {
    const u = route.request().url();
    if (/1click|jup\.ag|solanatracker|solanavibestation/.test(u)) return route.fallback();
    return route.abort();
  });

  const sigBytes = Keypair.generate().secretKey; // 64 random bytes → a realistic signature string
  await page.addInitScript(
    ({ owner, phantom, trusted, reject, quoteKey, tip, arrival, signature }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__signed = [];
      w.__ZECDOOR_E2E__ = {
        quoteKey,
        latestHeight: async () => tip,
        arrival: async (r: { from: number; index: number }) => (arrival ? { height: arrival.height, txid: 'ac36529f67ca10144dcbbe4f5214fa3d41436d54b27568d1d5168801efe4a29a', pool: 'ironwood', value: arrival.value, scope: 'external', index: r.index } : null),
      };
      if (!phantom) return;
      const pk = { toString: () => owner, toBase58: () => owner };
      let connected = false;
      w.phantom = {
        solana: {
          isPhantom: true,
          get publicKey() {
            return connected ? pk : null;
          },
          get isConnected() {
            return connected;
          },
          async connect(o?: { onlyIfTrusted?: boolean }) {
            if (o?.onlyIfTrusted && !trusted) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
            connected = true;
            return { publicKey: pk };
          },
          async disconnect() {
            connected = false;
          },
          async signAndSendTransaction(tx: { serialize(): Uint8Array }) {
            if (reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
            (w.__signed as string[]).push(btoa(String.fromCharCode(...tx.serialize())));
            return { signature };
          },
          on() {},
          off() {},
        },
      };
    },
    {
      owner: OWNER,
      phantom: s.phantom ?? true,
      trusted: s.trusted ?? true,
      reject: !!s.reject,
      quoteKey: QUOTE_KEY,
      tip: s.zcashTip ?? 3_510_000,
      arrival: s.arrival === undefined ? { height: 3_510_012, value: 8_663_100 } : s.arrival,
      signature: base58.encode(sigBytes),
    },
  );

  return {
    quotes,
    counted,
    signed: () => page.evaluate(() => (window as unknown as { __signed: string[] }).__signed),
  };
}

/** Decodes a transaction the mock Phantom was asked to sign. */
export const decodeSigned = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
