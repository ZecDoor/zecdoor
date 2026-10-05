// Mainnet runner for ZecDoor's own test moves (blocks B1/B7). Uses the app's real code path —
// makeQuoteRequest → checkQuote → prepareMove (allowlist) → simulateMove — and signs with a
// local throwaway keypair instead of Phantom.
//
// SAFETY
//   * Dry by default: real signed quote, real transaction, unsigned simulation. Nothing is sent.
//   * Sending needs --i-approve AND re-typing the first 6 characters of the deposit address.
//   * Budget: every sent move is written to ../.secrets/mainnet-ledger.json with its USD value;
//     a move that would take the total past $10 (decision D4) is refused before signing.
//
// USAGE (from the repo root)
//   pnpm exec tsx scripts/mainnet/move.ts exit    --keypair ../.secrets/topup-test-wallet.json
//   pnpm exec tsx scripts/mainnet/move.ts topup   --keypair … [--pay sol|usdc]
//   pnpm exec tsx scripts/mainnet/move.ts buyUsdc --keypair … --amount 3        (USDC)
//   pnpm exec tsx scripts/mainnet/move.ts buySol  --keypair … --amount 0.02     (SOL)
//   … add --i-approve to send. Recipient: a fresh address of the test wallet (../.secrets/zcash-test-ufvk.txt).
//   pnpm exec tsx scripts/mainnet/move.ts status  --deposit <address>           (re-poll and record)

import { Connection, Keypair } from '@solana/web3.js';
import {
  checkQuote,
  makeQuoteRequest,
  OneClickClient,
  prepareMove,
  simulateMove,
  type MoveKind,
  type QuoteResponse,
  type StatusResponse,
} from '@zecdoor/solana';
import { GrpcWebSource, MAINNET_GRPC_WEB } from '@zecdoor/zcash';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SECRETS = path.resolve(ROOT, '../.secrets');
const LEDGER = path.join(SECRETS, 'mainnet-ledger.json');
const RECORDS = path.resolve(ROOT, '../build-plan/mainnet-test/live');
const BUDGET_USD = 10;
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';

const argv = process.argv.slice(2);
const mode = argv[0] as MoveKind | 'status';
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (k: string) => argv.includes(`--${k}`);

interface LedgerEntry {
  at: string;
  kind: MoveKind;
  depositAddress: string;
  usdIn: number;
  signature?: string;
  status?: string;
  zcashTxid?: string;
  arrival?: unknown;
}
const ledger = (): LedgerEntry[] => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : []);
const saveLedger = (l: LedgerEntry[]) => fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n', { mode: 0o600 });
const spent = () => ledger().reduce((s, e) => s + e.usdIn, 0);

async function wasm() {
  const m = await import(path.join(ROOT, 'crates/zecdoor-wasm/pkg/zecdoor_wasm.js'));
  m.initSync({ module: fs.readFileSync(path.join(ROOT, 'crates/zecdoor-wasm/pkg/zecdoor_wasm_bg.wasm')) });
  return m as { address_at(u: string, n: string, i: number): string; Scanner: new (u: string, n: string) => { scan(b: Uint8Array): string; free(): void } };
}

function units(s: string, decimals: number): bigint {
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0').slice(0, decimals) || '0');
}

async function pollStatus(client: OneClickClient, dep: string, timeoutMin = 25): Promise<StatusResponse> {
  const until = Date.now() + timeoutMin * 60_000;
  let last = '';
  for (;;) {
    const s = await client.status(dep).catch(() => null);
    if (s && s.status !== last) {
      last = s.status;
      console.log(new Date().toISOString(), s.status);
    }
    if (s && ['SUCCESS', 'REFUNDED', 'FAILED'].includes(s.status)) return s;
    if (Date.now() > until) return s ?? { status: 'PENDING_DEPOSIT', updatedAt: '' };
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

async function scanArrival(ufvk: string, index: number, from: number, minValue: number) {
  const w = await wasm();
  const src = new GrpcWebSource(MAINNET_GRPC_WEB);
  const to = await src.latestHeight();
  const scanner = new w.Scanner(ufvk, 'main');
  try {
    for await (const block of src.blocks(from, to)) {
      for (const f of JSON.parse(scanner.scan(block)) as Array<{ index: number | null; value: number; txid: string; height: number; pool: string; scope: string }>) {
        if (f.scope === 'external' && f.index === index && f.value >= minValue) return f;
      }
    }
  } finally {
    scanner.free();
  }
  return null;
}

async function main() {
  const client = new OneClickClient();
  fs.mkdirSync(RECORDS, { recursive: true });

  if (mode === 'status') {
    const dep = opt('deposit');
    if (!dep) throw new Error('--deposit required');
    const s = await client.status(dep);
    fs.writeFileSync(path.join(RECORDS, `zecdoor_status_${dep.slice(0, 8)}.json`), JSON.stringify(s, null, 2) + '\n');
    console.log(s.status, s.swapDetails?.destinationChainTxHashes);
    return;
  }
  if (!['exit', 'topup', 'buyUsdc', 'buySol'].includes(mode)) throw new Error('mode: exit | topup | buyUsdc | buySol | status');

  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(opt('keypair') ?? '', 'utf8'))));
  const owner = kp.publicKey;
  const connection = new Connection(RPC, 'confirmed');
  const ufvk = fs.readFileSync(path.join(SECRETS, 'zcash-test-ufvk.txt'), 'utf8').trim();
  const w = await wasm();
  // A fresh address per move: diversifier index = 1000 + moves so far.
  const index = 1000 + ledger().length;
  const recipient = w.address_at(ufvk, 'main', index);
  const zcashFrom = await new GrpcWebSource(MAINNET_GRPC_WEB).latestHeight();

  let amount: bigint;
  if (mode === 'buyUsdc') amount = units(opt('amount') ?? '', 6);
  else if (mode === 'buySol') amount = units(opt('amount') ?? '', 9);
  else if (mode === 'exit') {
    const bal = await connection.getTokenAccountBalance((await import('@zecdoor/solana')).ata((await import('@zecdoor/solana')).ZEC_MINT, owner)).catch(() => null);
    amount = BigInt(bal?.value.amount ?? '0');
  } else {
    // top-up target: 1Click's suggested minimum, read from its error.
    const probe = makeQuoteRequest({ kind: 'exit', amount: 1n, recipient, refundTo: owner.toBase58(), dry: true });
    const err = await client.quote(probe).catch((e) => e);
    const m = /try at least (\d+)/.exec(String(err?.message));
    if (!m) throw new Error('could not read the minimum');
    amount = BigInt(m[1]!);
  }
  if (amount <= 0n) throw new Error('nothing to move');

  console.log(`owner ${owner.toBase58()}  kind ${mode}  amount ${amount}  recipient index ${index} ${recipient.slice(0, 12)}…`);
  const sent = makeQuoteRequest({ kind: mode, amount, recipient, refundTo: owner.toBase58(), dry: false });
  const quote: QuoteResponse = await client.quote(sent);
  checkQuote(quote, sent);
  const usdIn = Number(quote.quote.amountInUsd) + (mode === 'topup' ? 2 : 0.5); // + swap and rent, generous
  console.log(`quote ok: deposit ${quote.quote.depositAddress}  in $${Number(quote.quote.amountInUsd).toFixed(2)}  minOut ${quote.quote.minAmountOut} zat`);

  const prepared = await prepareMove({ connection, kind: mode, owner, quote, ...(mode === 'topup' ? { topUpWith: (opt('pay') as 'sol' | 'usdc') ?? 'sol' } : {}) });
  const sim = await simulateMove(connection, prepared.tx, prepared.allowlist);
  console.log(`simulation: ok=${sim.ok} receives=${sim.depositReceives} bytes=${sim.bytes} units=${sim.unitsConsumed}`, sim.ok ? '' : sim.logs.slice(-6));
  if (!sim.ok || sim.depositReceives !== BigInt(quote.quote.amountIn)) throw new Error('simulation failed; nothing sent');

  if (!flag('i-approve')) {
    console.log('DRY RUN: nothing signed or sent. Add --i-approve to send.');
    return;
  }
  if (spent() + usdIn > BUDGET_USD) {
    throw new Error(`budget: $${spent().toFixed(2)} spent + ~$${usdIn.toFixed(2)} would pass $${BUDGET_USD}. Ask before raising it.`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`Type the first 6 characters of the deposit address to send: `)).trim();
  rl.close();
  if (typed !== quote.quote.depositAddress.slice(0, 6)) throw new Error('confirmation did not match; nothing sent');

  prepared.tx.sign([kp]);
  const signature = await connection.sendRawTransaction(prepared.tx.serialize(), { maxRetries: 3 });
  const entry: LedgerEntry = { at: new Date().toISOString(), kind: mode, depositAddress: quote.quote.depositAddress, usdIn, signature };
  saveLedger([...ledger(), entry]);
  console.log('sent', signature);
  await connection.confirmTransaction(signature, 'confirmed').catch(() => {});
  await client.submitDeposit(signature, quote.quote.depositAddress);

  const s = await pollStatus(client, quote.quote.depositAddress);
  const zcashTxid = s.swapDetails?.destinationChainTxHashes?.find((h) => /^[0-9a-f]{64}$/i.test(h.hash))?.hash;
  fs.writeFileSync(path.join(RECORDS, `zecdoor_${mode}_${quote.quote.depositAddress.slice(0, 8)}.json`), JSON.stringify({ quote, signature, status: s, recipientIndex: index }, null, 2) + '\n');
  let arrival = null;
  if (s.status === 'SUCCESS') {
    for (let i = 0; i < 12 && !arrival; i++) {
      arrival = await scanArrival(ufvk, index, zcashFrom, Number(quote.quote.minAmountOut));
      if (!arrival) await new Promise((r) => setTimeout(r, 30_000));
    }
    console.log('arrival', arrival, 'txid matches 1Click:', arrival ? arrival.txid === zcashTxid?.toLowerCase() : 'n/a');
  }
  saveLedger(ledger().map((e) => (e.depositAddress === entry.depositAddress ? { ...e, status: s.status, ...(zcashTxid ? { zcashTxid } : {}), arrival } : e)));
  console.log(`ledger total: $${spent().toFixed(2)} of $${BUDGET_USD}`);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(1);
});
