// Inspects a ZecDoor move after it landed on Solana mainnet: what the wallet added or changed
// compared with what our builder makes, how big the transaction is on the wire against Solana's
// 1,232-byte packet limit, and whether it still passes our instruction allowlist.
//
// Read-only: it fetches the transaction and the 1Click status. Nothing is signed or sent.
//
// USAGE (from the repo root)
//   pnpm exec tsx scripts/mainnet/inspect-landed.ts <signature> [--out <dir>] [--kind exit|topup|buyUsdc|buySol] [--rpc <url>]
// With --out it writes <dir>/inspect-<sig8>.json (everything) and <dir>/inspect-<sig8>.md (a table for docs).

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSET,
  ATA_PROGRAM,
  buySolInstructions,
  buyUsdcInstructions,
  checkTransaction,
  compile,
  COMPUTE_BUDGET_PROGRAM,
  COMPUTE_UNITS,
  exitInstructions,
  JUPITER_PROGRAM,
  MAX_TX_BYTES,
  OneClickClient,
  prepareMove,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  USDC_MINT,
  verifyQuoteSignature,
  WSOL_MINT,
  ZEC_MINT,
  ata,
  type AllowlistContext,
  type MoveKind,
  type QuoteResponse,
  type StatusResponse,
} from '@zecdoor/solana';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SIG = argv[0] ?? '';
if (!SIG || SIG.startsWith('--')) throw new Error('usage: inspect-landed.ts <signature> [--out <dir>] [--kind …] [--rpc <url>]');
const OUT = opt('out');
const KIND_OVERRIDE = opt('kind') as MoveKind | undefined;
if (KIND_OVERRIDE && !['exit', 'topup', 'buyUsdc', 'buySol'].includes(KIND_OVERRIDE)) throw new Error('kind: exit | topup | buyUsdc | buySol');

// The public RPCs the app uses (apps/app/src/config.ts SOLANA_RPCS) back up the Foundation's.
const RPCS = [opt('rpc') ?? process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com', 'https://rpc.solanatracker.io/public', 'https://public.rpc.solanavibestation.com'];
const PACKET_BYTES = 1232;

// Lighthouse (github.com/Jac0xb/lighthouse, declare_id in programs/lighthouse/src/lib.rs). Phantom's
// extension lists both: L1TEV… is the older deployment, L2TEx… the current one.
const LIGHTHOUSE = ['L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95', 'L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK'];
const LIGHTHOUSE_IX = [
  'MemoryWrite', 'MemoryClose', 'AssertAccountData', 'AssertAccountDataMulti', 'AssertAccountDelta', 'AssertAccountInfo',
  'AssertAccountInfoMulti', 'AssertMintAccount', 'AssertMintAccountMulti', 'AssertTokenAccount', 'AssertTokenAccountMulti',
  'AssertStakeAccount', 'AssertStakeAccountMulti', 'AssertUpgradeableLoaderAccount', 'AssertUpgradeableLoaderAccountMulti',
  'AssertSysvarClock', 'AssertMerkleTreeAccount', 'AssertBubblegumTreeConfigAccount',
];
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MEMO = ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'];
const PROGRAM_NAMES: Record<string, string> = {
  [COMPUTE_BUDGET_PROGRAM.toBase58()]: 'ComputeBudget',
  [SYSTEM_PROGRAM.toBase58()]: 'System',
  [TOKEN_PROGRAM.toBase58()]: 'Token',
  [TOKEN_2022]: 'Token-2022',
  [ATA_PROGRAM.toBase58()]: 'Associated Token',
  [JUPITER_PROGRAM.toBase58()]: 'Jupiter v6',
  ...Object.fromEntries(LIGHTHOUSE.map((p) => [p, 'Lighthouse'])),
  ...Object.fromEntries(MEMO.map((p) => [p, 'Memo'])),
};
const MINT_NAMES: Record<string, string> = { [ZEC_MINT.toBase58()]: 'ZEC', [USDC_MINT.toBase58()]: 'USDC', [WSOL_MINT.toBase58()]: 'wSOL' };

const JUPITER_ROUTES = [
  'route', 'route_with_token_ledger', 'exact_out_route', 'shared_accounts_route', 'shared_accounts_route_with_token_ledger',
  'shared_accounts_exact_out_route', 'route_v2', 'exact_out_route_v2', 'shared_accounts_route_v2', 'shared_accounts_exact_out_route_v2',
];
const JUPITER_BY_DISC = Object.fromEntries(
  JUPITER_ROUTES.map((n) => [createHash('sha256').update(`global:${n}`).digest().subarray(0, 8).toString('hex'), n]),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const u16 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 2).getUint16(0, true);
const u32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 4).getUint32(0, true);
const u64 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 8).getBigUint64(0, true);
const hex = (d: Uint8Array) => Buffer.from(d).toString('hex');

// ---- RPC ----

interface TokenBalance { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
interface RpcTx {
  slot: number;
  blockTime: number | null;
  version: 'legacy' | 0;
  transaction: unknown;
  meta: {
    err: unknown;
    fee: number;
    computeUnitsConsumed?: number;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    logMessages?: string[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
}
interface ParsedIx { programId: string; parsed?: { type?: string; info?: Record<string, unknown> } | string; program?: string }

async function rpc<T>(method: string, params: unknown[]): Promise<{ result: T; url: string }> {
  let last: unknown;
  for (const url of RPCS) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (res.status === 429) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        const j = (await res.json()) as { result?: T; error?: { message: string } };
        if (j.error) throw new Error(j.error.message);
        if (j.result == null) throw new Error(`${method}: not found on ${url}`);
        return { result: j.result, url };
      } catch (e) {
        last = e;
        break;
      }
    }
  }
  throw new Error(`${method} failed on every RPC: ${(last as Error)?.message ?? last}`);
}

// ---- Decoding ----

interface Decoded {
  program: string;
  kind: string;
  summary: string;
  values?: Record<string, string | number>;
}

function describe(ix: TransactionInstruction, ownerOf: (a: string) => TokenBalance | undefined, parsed?: ParsedIx): Decoded {
  const p = ix.programId.toBase58();
  const d = ix.data;
  const k = (n: number) => ix.keys[n]?.pubkey.toBase58() ?? '?';
  const program = PROGRAM_NAMES[p] ?? 'unknown';
  const rpcType = parsed && typeof parsed.parsed === 'object' ? parsed.parsed.type : undefined;

  if (program === 'ComputeBudget') {
    if (d[0] === 2) return { program, kind: 'computeBudget.setComputeUnitLimit', summary: `limit ${u32(d, 1)} CU`, values: { units: u32(d, 1) } };
    if (d[0] === 3) {
      const price = u64(d, 1);
      return { program, kind: 'computeBudget.setComputeUnitPrice', summary: `price ${price} µlamports/CU`, values: { microLamports: price.toString() } };
    }
    if (d[0] === 1) return { program, kind: 'computeBudget.requestHeapFrame', summary: `heap ${u32(d, 1)} bytes` };
    if (d[0] === 4) return { program, kind: 'computeBudget.setLoadedAccountsDataSizeLimit', summary: `loaded data ${u32(d, 1)} bytes` };
    return { program, kind: `computeBudget.${d[0]}`, summary: `compute budget instruction ${d[0]}` };
  }
  if (program === 'System') {
    const tag = d.length >= 4 ? u32(d, 0) : -1;
    if (tag === 2 && d.length === 12) {
      const lamports = u64(d, 4);
      return { program, kind: 'system.transfer', summary: `${lamports} lamports ${short(k(0))} → ${short(k(1))}`, values: { lamports: lamports.toString(), to: k(1) } };
    }
    const names: Record<number, string> = { 0: 'createAccount', 1: 'assign', 3: 'createAccountWithSeed', 4: 'advanceNonceAccount', 8: 'allocate', 11: 'transferWithSeed' };
    return { program, kind: `system.${names[tag] ?? tag}`, summary: names[tag] ?? rpcType ?? `system instruction ${tag}` };
  }
  if (program === 'Token' || program === 'Token-2022') {
    const op = d[0] ?? -1;
    const fam = program === 'Token' ? 'token' : 'token2022';
    const dest = (a: string) => {
      const o = ownerOf(a);
      return o?.owner ? `${short(a)} (owner ${short(o.owner)})` : short(a);
    };
    if (op === 12) {
      const amount = u64(d, 1);
      const mint = MINT_NAMES[k(1)] ?? short(k(1));
      return {
        program, kind: `${fam}.transferChecked`,
        summary: `${amount} ${mint} (dec ${d[9]}) → ${dest(k(2))}`,
        values: { amount: amount.toString(), mint: k(1), destination: k(2), destinationOwner: ownerOf(k(2))?.owner ?? '' },
      };
    }
    if (op === 3) {
      const amount = u64(d, 1);
      return { program, kind: `${fam}.transfer`, summary: `${amount} → ${dest(k(1))}`, values: { amount: amount.toString(), destination: k(1), destinationOwner: ownerOf(k(1))?.owner ?? '' } };
    }
    if (op === 9) return { program, kind: `${fam}.closeAccount`, summary: `close ${short(k(0))}, rent → ${short(k(1))}` };
    if (op === 17) return { program, kind: `${fam}.syncNative`, summary: `sync ${short(k(0))}` };
    const names: Record<number, string> = { 0: 'initializeMint', 1: 'initializeAccount', 4: 'approve', 5: 'revoke', 6: 'setAuthority', 7: 'mintTo', 8: 'burn', 13: 'approveChecked', 14: 'mintToChecked', 15: 'burnChecked', 18: 'initializeAccount3' };
    return { program, kind: `${fam}.${names[op] ?? op}`, summary: names[op] ?? rpcType ?? `token instruction ${op}` };
  }
  if (program === 'Associated Token') {
    const op = d.length === 0 ? 0 : d[0]!;
    const name = ['create', 'createIdempotent', 'recoverNested'][op] ?? String(op);
    const mint = MINT_NAMES[k(3)] ?? short(k(3));
    return { program, kind: `ata.${name}`, summary: `${name} ${mint} account for ${short(k(2))}`, values: { wallet: k(2), mint: k(3), account: k(1) } };
  }
  if (program === 'Jupiter v6') {
    const name = JUPITER_BY_DISC[hex(d.subarray(0, 8))];
    const eo = name ? exactOutArgs(name, d) : null;
    if (eo) {
      return {
        program, kind: 'jupiter.exactOut',
        summary: `${name}: out ${eo.outAmount}, quoted in ${eo.quotedIn}, slippage ${eo.slippageBps} bps (max in ${eo.maxIn})`,
        values: { route: name!, outAmount: eo.outAmount.toString(), quotedIn: eo.quotedIn.toString(), slippageBps: eo.slippageBps, maxIn: eo.maxIn.toString() },
      };
    }
    return { program, kind: `jupiter.${name ?? 'unknown'}`, summary: name ?? `unknown Jupiter instruction ${hex(d.subarray(0, 8))}` };
  }
  if (program === 'Lighthouse') {
    const name = LIGHTHOUSE_IX[d[0] ?? -1] ?? `instruction ${d[0]}`;
    return { program, kind: `lighthouse.${name}`, summary: `${name} on ${short(k(0))} (${d.length} data bytes, ${ix.keys.length} accounts)` };
  }
  if (program === 'Memo') return { program, kind: 'memo', summary: JSON.stringify(Buffer.from(d).toString('utf8').slice(0, 80)) };
  return { program, kind: `unknown.${short(p)}`, summary: rpcType ?? `${d.length} data bytes, ${ix.keys.length} accounts` };
}

/** The amounts Jupiter's exact-output routes carry (layouts from the program's on-chain IDL). */
function exactOutArgs(name: string, d: Uint8Array) {
  let out: number;
  if (name === 'exact_out_route' || name === 'shared_accounts_exact_out_route') out = d.length - 19; // …route_plan, out, quoted_in, slippage u16, fee u8
  else if (name === 'exact_out_route_v2') out = 8;
  else if (name === 'shared_accounts_exact_out_route_v2') out = 9; // after the u8 id
  else return null;
  const outAmount = u64(d, out);
  const quotedIn = u64(d, out + 8);
  const slippageBps = u16(d, out + 16);
  // Jupiter's otherAmountThreshold for ExactOut: quoted input plus slippage, rounded up.
  const maxIn = (quotedIn * (10_000n + BigInt(slippageBps)) + 9_999n) / 10_000n;
  return { outAmount, quotedIn, slippageBps, maxIn };
}

/** Lookup tables as they were when the transaction landed, rebuilt from meta.loadedAddresses. */
function landedTables(tx: VersionedTransaction, loaded: { writable: string[]; readonly: string[] }): AddressLookupTableAccount[] {
  let w = 0;
  let r = 0;
  return tx.message.addressTableLookups.map((l) => {
    const size = Math.max(-1, ...l.writableIndexes, ...l.readonlyIndexes) + 1;
    // Unused slots get unique filler keys so they can never match a real account.
    const addresses = Array.from({ length: size }, () => PublicKey.unique());
    for (const i of l.writableIndexes) addresses[i] = new PublicKey(loaded.writable[w++]!);
    for (const i of l.readonlyIndexes) addresses[i] = new PublicKey(loaded.readonly[r++]!);
    return new AddressLookupTableAccount({
      key: l.accountKey,
      state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses },
    });
  });
}

/** Compute units each top-level instruction used, read from the program logs. */
function unitsPerInstruction(logs: string[]): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  let depth = 0;
  for (const line of logs) {
    const inv = /^Program \S+ invoke \[(\d+)\]$/.exec(line);
    if (inv) {
      depth = Number(inv[1]);
      if (depth === 1) out.push(undefined);
      continue;
    }
    const used = /^Program \S+ consumed (\d+) of \d+ compute units$/.exec(line);
    if (used && depth === 1) out[out.length - 1] = Number(used[1]);
    if (/^Program \S+ (success|failed)/.test(line)) depth = Math.max(0, depth - 1);
  }
  return out;
}

// ---- What our builder emits ----

interface Profile { min: number; max: number }

/** The compute unit price `compile` sets when the caller passes none (the app passes none). */
function defaultUnitPrice(): bigint {
  const tx = compile({ payer: PublicKey.unique(), instructions: [], blockhash: PublicKey.default.toBase58() });
  const ix = TransactionMessage.decompile(tx.message).instructions.find((i) => i.data[0] === 3)!;
  return u64(ix.data, 1);
}

/**
 * Instruction kinds (with counts) our builder emits for a move kind, read off the builder itself
 * by running it on throwaway keys. The top-up's Jupiter part comes from Jupiter's API, so for it
 * we take the kinds the allowlist admits around the swap (user token accounts, one wrap, sync,
 * one exact-out route, close).
 */
function builderProfile(kind: MoveKind): Record<string, Profile> {
  const ctx = { kind, owner: PublicKey.unique(), depositAddress: PublicKey.unique(), amountIn: 1n };
  const kindsOf = (ixs: TransactionInstruction[]) => {
    const tx = compile({ payer: ctx.owner, instructions: ixs, blockhash: PublicKey.default.toBase58() });
    return TransactionMessage.decompile(tx.message).instructions.map((i) => describe(i, () => undefined).kind);
  };
  const count = (kinds: string[]) => kinds.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
  const lo = count(kindsOf(kind === 'buySol' ? buySolInstructions(ctx) : kind === 'buyUsdc' ? buyUsdcInstructions(ctx) : exitInstructions(ctx)));
  const hi = count(kindsOf(kind === 'buySol' ? buySolInstructions(ctx) : kind === 'buyUsdc' ? buyUsdcInstructions(ctx) : exitInstructions(ctx, { closeEmptied: kind === 'exit' })));
  const p: Record<string, Profile> = {};
  for (const k of new Set([...Object.keys(lo), ...Object.keys(hi)])) p[k] = { min: lo[k] ?? 0, max: hi[k] ?? 0 };
  if (kind === 'topup') {
    p['ata.createIdempotent'] = { min: 1, max: 4 };
    p['system.transfer'] = { min: 0, max: 1 };
    p['token.syncNative'] = { min: 0, max: 1 };
    p['token.closeAccount'] = { min: 0, max: 1 };
    p['jupiter.exactOut'] = { min: 1, max: 1 };
  }
  return p;
}

// ---- Main ----

interface Row extends Decoded {
  index: number;
  programId: string;
  accounts: number;
  dataBytes: number;
  computeUnits?: number;
  origin: 'ours' | 'added' | 'changed';
  note?: string;
}

const jsonSafe = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof PublicKey ? v.toBase58() : v);

async function main() {
  const b64 = await rpc<RpcTx>('getTransaction', [SIG, { encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  const parsedTx = await rpc<RpcTx>('getTransaction', [SIG, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  const raw = b64.result;
  const meta = raw.meta;
  const wire = Buffer.from((raw.transaction as [string, string])[0], 'base64');
  const tx = VersionedTransaction.deserialize(wire);
  const msg = tx.message;
  const loaded = meta?.loadedAddresses ?? { writable: [], readonly: [] };
  const tables = landedTables(tx, loaded);
  const allKeys = [...msg.staticAccountKeys.map((k) => k.toBase58()), ...loaded.writable, ...loaded.readonly];
  const balances = [...(meta?.preTokenBalances ?? []), ...(meta?.postTokenBalances ?? [])];
  const ownerOf = (a: string) => balances.find((b) => allKeys[b.accountIndex] === a);
  const parsedIxs = ((parsedTx.result.transaction as { message: { instructions: ParsedIx[] } }).message.instructions) ?? [];
  const ixs = TransactionMessage.decompile(msg, { addressLookupTableAccounts: tables }).instructions;
  const units = unitsPerInstruction(meta?.logMessages ?? []);
  const owner = msg.staticAccountKeys[0]!;

  const rows: Row[] = ixs.map((ix, i) => ({
    index: i,
    programId: ix.programId.toBase58(),
    ...describe(ix, ownerOf, parsedIxs[i]),
    accounts: ix.keys.length,
    dataBytes: ix.data.length,
    ...(units[i] !== undefined ? { computeUnits: units[i] } : {}),
    origin: 'ours',
  }));

  // Deposit address: the owner of the token account the transfer pays into, else a SOL transfer's target.
  const ownerWsol = ata(WSOL_MINT, owner).toBase58();
  const tokenPay = rows.find((r) => /^token(2022)?\.transfer/.test(r.kind) && r.values?.destinationOwner && r.values.destinationOwner !== owner.toBase58());
  const solPay = rows.find((r) => r.kind === 'system.transfer' && r.values?.to !== ownerWsol && r.values?.to !== owner.toBase58());
  const depositGuess = (tokenPay?.values?.destinationOwner as string | undefined) || (solPay?.values?.to as string | undefined);

  let status: StatusResponse | null = null;
  let statusError: string | undefined;
  if (depositGuess) {
    status = await new OneClickClient().status(depositGuess).catch((e: Error) => {
      statusError = e.message;
      return null;
    });
  }
  const quote: QuoteResponse | null = status?.quoteResponse?.quote?.depositAddress ? status.quoteResponse : null;
  const hasSwap = rows.some((r) => r.program === 'Jupiter v6');
  const origin = quote?.quoteRequest.originAsset;
  const kindFromQuote: MoveKind | undefined =
    origin === ASSET.solanaZec ? (hasSwap ? 'topup' : 'exit') : origin === ASSET.solanaUsdc ? 'buyUsdc' : origin === ASSET.sol ? 'buySol' : undefined;
  const kindFromTx: MoveKind = hasSwap ? 'topup' : tokenPay ? (tokenPay.values?.mint === USDC_MINT.toBase58() ? 'buyUsdc' : 'exit') : 'buySol';
  const kind: MoveKind = KIND_OVERRIDE ?? kindFromQuote ?? kindFromTx;
  const kindSource = KIND_OVERRIDE ? '--kind' : kindFromQuote ? '1Click quote origin asset' : 'guessed from the instructions (no 1Click quote)';

  // Classify each instruction against what our builder emits for this kind.
  const profile = builderProfile(kind);
  const used: Record<string, number> = {};
  const expectLimit = COMPUTE_UNITS[kind];
  const expectPrice = defaultUnitPrice();
  for (const r of rows) {
    const pr = profile[r.kind];
    used[r.kind] = (used[r.kind] ?? 0) + 1;
    if (!pr || used[r.kind]! > pr.max) {
      r.origin = 'added';
      r.note = r.program === 'Lighthouse' ? 'Lighthouse assertion: a wallet guard, never built by ZecDoor' : pr ? `more ${r.kind} than our builder makes` : 'not something our builder emits';
      continue;
    }
    if (r.kind === 'computeBudget.setComputeUnitLimit' && r.values?.units !== expectLimit) {
      r.origin = 'changed';
      r.note = `ours sets ${expectLimit} CU`;
    }
    if (r.kind === 'computeBudget.setComputeUnitPrice' && BigInt(r.values?.microLamports ?? 0) !== expectPrice) {
      r.origin = 'changed';
      r.note = `ours sets ${expectPrice} µlamports/CU`;
    }
  }
  const missing = Object.entries(profile)
    .filter(([k, p]) => (used[k] ?? 0) < p.min)
    .map(([k, p]) => `${k} (ours makes ${p.min}, landed has ${used[k] ?? 0})`);
  const added = rows.filter((r) => r.origin === 'added');
  const changed = rows.filter((r) => r.origin === 'changed');

  // The same transaction without some instructions, recompiled in the same version against the same tables.
  const without = (drop: (r: Row) => boolean) => {
    const m = new TransactionMessage({ payerKey: owner, recentBlockhash: msg.recentBlockhash, instructions: ixs.filter((_, i) => !drop(rows[i]!)) });
    return new VersionedTransaction(msg.version === 0 ? m.compileToV0Message(tables) : m.compileToLegacyMessage());
  };
  const stripped = without((r) => r.origin === 'added');
  const strippedBytes = stripped.serialize().length;
  const lighthouseBytes = wire.length - without((r) => r.program === 'Lighthouse').serialize().length;

  // Allowlist, with the expected values we can recover after the fact.
  const checks: string[] = [];
  const amountIn = quote ? BigInt(quote.quote.amountIn) : BigInt((tokenPay ?? solPay)?.values?.[tokenPay ? 'amount' : 'lamports'] ?? 0);
  const depositAddress = new PublicKey(quote?.quote.depositAddress ?? depositGuess ?? PublicKey.default);
  checks.push(`kind ${kind} (${kindSource})`);
  checks.push(`owner = fee payer ${owner.toBase58()}` + (quote ? (quote.quoteRequest.refundTo === owner.toBase58() ? ' (matches the quote refundTo)' : ` (quote refundTo is ${quote.quoteRequest.refundTo}: MISMATCH)`) : ''));
  checks.push(quote ? `deposit address and amountIn ${amountIn} from the 1Click quote` : `no 1Click quote${statusError ? ` (${statusError})` : ''}: deposit address guessed from the transfer and amount taken from the transfer itself, so the amount check proves nothing`);
  if (quote) checks.push(`1Click quote signature: ${verifyQuoteSignature(quote) ? 'valid' : 'NOT valid'}`);
  let maxWrapLamports: bigint | undefined;
  if (kind === 'topup') {
    const swap = rows.find((r) => r.kind === 'jupiter.exactOut');
    const wraps = rows.some((r) => r.kind === 'system.transfer' && r.values?.to === ownerWsol);
    if (swap && wraps) {
      maxWrapLamports = BigInt(swap.values!.maxIn!);
      checks.push(`wrap cap ${maxWrapLamports} lamports rebuilt from the swap instruction (quoted in × (1 + slippage), as Jupiter computes otherAmountThreshold); the app takes it from the Jupiter quote, so this proves the wrap fits the swap, not that the swap matches what the user saw`);
    } else if (swap) {
      maxWrapLamports = 0n;
      checks.push('no SOL wrap: swap pays with USDC, wrap cap 0');
    }
  }
  checks.push("not re-run: checkQuote's comparison with the request the app sent (only 1Click's echo of it survives) and the deadline");
  const allowCtx: AllowlistContext = { kind, owner, depositAddress, amountIn, lookupTables: tables, ...(maxWrapLamports !== undefined ? { maxWrapLamports } : {}) };
  const allowlist = checkTransaction(tx, allowCtx);
  const allowlistWithoutAdded = checkTransaction(stripped, allowCtx);

  // Rebuild what our code makes for the same move and compare. Top-up routes are not reproducible.
  let rebuild: { how: string; bytes: number; diff: Array<{ landed?: number; ours?: number; result: string }> } | { how: string; kinds: { ours: string; landed: string; match: boolean } } | null = null;
  if (kind !== 'topup') {
    const conn = new Connection(RPCS[0]!, 'confirmed');
    let ours: VersionedTransaction;
    let how: string;
    if (quote) {
      ours = (await prepareMove({ connection: conn, kind, owner, quote })).tx;
      how = 'prepareMove with the 1Click quote (fresh blockhash, unsigned, not sent)';
    } else {
      const ctx = { kind, owner, depositAddress, amountIn };
      const ixs2 = kind === 'exit' ? exitInstructions(ctx) : kind === 'buyUsdc' ? buyUsdcInstructions(ctx) : buySolInstructions(ctx);
      ours = compile({ payer: owner, instructions: ixs2, blockhash: msg.recentBlockhash, computeUnits: COMPUTE_UNITS[kind] });
      how = 'builder functions with the guessed deposit and amount (no quote)';
    }
    const oursIxs = TransactionMessage.decompile(ours.message).instructions;
    const diff: Array<{ landed?: number; ours?: number; result: string }> = [];
    let j = 0;
    for (const r of rows) {
      if (r.origin === 'added') {
        diff.push({ landed: r.index, result: `added: ${r.program} ${r.kind}` });
        continue;
      }
      const o = oursIxs[j];
      if (!o) {
        diff.push({ landed: r.index, result: 'landed has it, ours does not' });
        continue;
      }
      const l = ixs[r.index]!;
      const diffs: string[] = [];
      if (!o.programId.equals(l.programId)) diffs.push(`program ${o.programId.toBase58()} vs ${l.programId.toBase58()}`);
      if (hex(o.data) !== hex(l.data)) diffs.push(`data: ours ${describe(o, ownerOf).summary} / landed ${r.summary}`);
      const n = Math.max(o.keys.length, l.keys.length);
      for (let a = 0; a < n; a++) {
        const x = o.keys[a];
        const y = l.keys[a];
        if (!x || !y || !x.pubkey.equals(y.pubkey) || x.isSigner !== y.isSigner || x.isWritable !== y.isWritable) {
          diffs.push(`account ${a}: ours ${x ? `${short(x.pubkey.toBase58())}${x.isSigner ? ' s' : ''}${x.isWritable ? ' w' : ''}` : '-'} / landed ${y ? `${short(y.pubkey.toBase58())}${y.isSigner ? ' s' : ''}${y.isWritable ? ' w' : ''}` : '-'}`);
        }
      }
      diff.push({ landed: r.index, ours: j, result: diffs.length ? diffs.join('; ') : 'identical' });
      j++;
    }
    for (; j < oursIxs.length; j++) diff.push({ ours: j, result: `ours has ${describe(oursIxs[j]!, ownerOf).kind}, landed does not` });
    rebuild = { how, bytes: ours.serialize().length, diff };
  } else {
    const oursKinds = rows.filter((r) => r.origin !== 'added').map((r) => r.kind);
    const shape = 'computeBudget.setComputeUnitLimit, computeBudget.setComputeUnitPrice, [Jupiter setup], jupiter.exactOut, [Jupiter cleanup], ata.createIdempotent, token.transferChecked';
    const match =
      oursKinds[0] === 'computeBudget.setComputeUnitLimit' &&
      oursKinds[1] === 'computeBudget.setComputeUnitPrice' &&
      oursKinds.filter((k) => k === 'jupiter.exactOut').length === 1 &&
      oursKinds.at(-2) === 'ata.createIdempotent' &&
      oursKinds.at(-1) === 'token.transferChecked';
    rebuild = { how: 'top-up: Jupiter routes are not reproducible, so compared by instruction kind only', kinds: { ours: shape, landed: oursKinds.join(', '), match } };
  }

  const limitRow = rows.find((r) => r.kind === 'computeBudget.setComputeUnitLimit');
  const priceRow = rows.find((r) => r.kind === 'computeBudget.setComputeUnitPrice');
  const report = {
    signature: SIG,
    rpc: b64.url,
    slot: raw.slot,
    blockTime: raw.blockTime ? new Date(raw.blockTime * 1000).toISOString() : null,
    executed: meta?.err === null ? 'ok' : 'failed',
    err: meta?.err ?? null,
    size: {
      wireBytes: wire.length,
      marginTo1232: PACKET_BYTES - wire.length,
      marginToOurBudget: MAX_TX_BYTES - wire.length,
      withoutAddedBytes: strippedBytes,
      addedBytes: wire.length - strippedBytes,
      lighthouseBytes,
      lighthouseInstructions: rows.filter((r) => r.program === 'Lighthouse').length,
    },
    version: msg.version,
    signatures: tx.signatures.length,
    staticAccountKeys: msg.staticAccountKeys.map((k) => k.toBase58()),
    lookupTables: msg.addressTableLookups.map((l) => ({
      table: l.accountKey.toBase58(),
      writable: l.writableIndexes.length,
      readonly: l.readonlyIndexes.length,
      loaded: l.writableIndexes.length + l.readonlyIndexes.length,
    })),
    computeBudget: {
      unitLimit: limitRow?.values?.units ?? null,
      unitPriceMicroLamports: priceRow?.values?.microLamports ?? null,
      oursWouldSet: { unitLimit: expectLimit, unitPriceMicroLamports: expectPrice.toString(), source: 'COMPUTE_UNITS and compile() defaults in packages/solana/src/build.ts; fixed, not from simulation' },
      unitsConsumed: meta?.computeUnitsConsumed ?? null,
      feeLamports: meta?.fee ?? null,
    },
    owner: owner.toBase58(),
    kind,
    kindSource,
    depositAddress: depositAddress.toBase58(),
    oneClick: status ? { status: status.status, amountIn: quote?.quote.amountIn, depositedAmount: status.swapDetails?.depositedAmount, refundReason: status.swapDetails?.refundReason } : { error: statusError ?? 'no deposit address found' },
    instructions: rows,
    addedByWallet: added.map((r) => ({ index: r.index, program: r.program, kind: r.kind, dataBytes: r.dataBytes, accounts: r.accounts, computeUnits: r.computeUnits })),
    changedByWallet: changed.map((r) => ({ index: r.index, kind: r.kind, landed: r.summary, note: r.note })),
    missingFromLanded: missing,
    allowlist: { ok: allowlist.ok, violations: allowlist.violations, checksRan: checks },
    allowlistWithoutAdded: { ok: allowlistWithoutAdded.ok, violations: allowlistWithoutAdded.violations },
    rebuild,
  };

  // ---- Print ----
  const L = (s = '') => console.log(s);
  L(`${SIG}`);
  L(`  slot ${raw.slot}  ${report.blockTime ?? ''}  executed: ${report.executed}${meta?.err ? ` ${JSON.stringify(meta.err)}` : ''}  (via ${b64.url})`);
  L(`  size ${wire.length} bytes on the wire: ${report.size.marginTo1232} under 1,232, ${report.size.marginToOurBudget} under our ${MAX_TX_BYTES} budget`);
  L(`  v${msg.version}, ${tx.signatures.length} signature(s), ${msg.staticAccountKeys.length} static keys, ${report.lookupTables.map((t) => `${short(t.table)} +${t.loaded}`).join(', ') || 'no lookup tables'}`);
  L(`  compute: limit ${report.computeBudget.unitLimit ?? '-'} (ours ${expectLimit}), price ${report.computeBudget.unitPriceMicroLamports ?? '-'} µlamports (ours ${expectPrice}), used ${report.computeBudget.unitsConsumed ?? '-'}, fee ${meta?.fee ?? '-'} lamports`);
  L(`  kind ${kind} (${kindSource}); owner ${owner.toBase58()}; deposit ${depositAddress.toBase58()}${status ? `; 1Click ${status.status}` : ''}`);
  L();
  for (const r of rows) L(`  ${String(r.index).padStart(2)} ${r.origin.padEnd(7)} ${r.program.padEnd(16)} ${r.summary}${r.computeUnits !== undefined ? `  [${r.computeUnits} CU]` : ''}${r.note ? `  (${r.note})` : ''}`);
  L();
  L(`  added by the wallet: ${added.length ? added.map((r) => `#${r.index} ${r.kind}`).join(', ') : 'nothing'}`);
  L(`  changed from what our builder sets: ${changed.length ? changed.map((r) => `#${r.index} ${r.summary} (${r.note})`).join(', ') : 'nothing'}`);
  if (missing.length) L(`  missing from the landed transaction: ${missing.join(', ')}`);
  L(`  bytes the additions cost: ${report.size.addedBytes} (${strippedBytes} without them); Lighthouse alone: ${lighthouseBytes} bytes for ${report.size.lighthouseInstructions} instruction(s)`);
  L(`  allowlist on the landed transaction: ${allowlist.ok ? 'PASS' : 'FAIL'}`);
  for (const v of allowlist.violations) L(`    - ${v}`);
  L(`  allowlist without the added instructions: ${allowlistWithoutAdded.ok ? 'PASS' : 'FAIL'}${allowlistWithoutAdded.violations.length ? `: ${allowlistWithoutAdded.violations.join('; ')}` : ''}`);
  L('  checks:');
  for (const c of checks) L(`    · ${c}`);
  if (rebuild && 'diff' in rebuild) {
    L(`  rebuilt (${rebuild.how}): ${rebuild.bytes} bytes`);
    for (const d of rebuild.diff) L(`    landed #${d.landed ?? '-'} vs ours #${d.ours ?? '-'}: ${d.result}`);
  } else if (rebuild) {
    L(`  ${rebuild.how}: ${rebuild.kinds.match ? 'same shape' : 'DIFFERENT shape'}`);
    L(`    ours:   ${rebuild.kinds.ours}`);
    L(`    landed: ${rebuild.kinds.landed}`);
  }

  if (OUT) {
    const dir = path.resolve(OUT);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `inspect-${SIG.slice(0, 8)}`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(report, jsonSafe, 2) + '\n');
    const md = [
      `### ${SIG.slice(0, 8)}… (${kind}${status ? `, 1Click ${status.status}` : ''})`,
      '',
      `[\`${SIG}\`](https://solscan.io/tx/${SIG})`,
      '',
      '| | |',
      '|---|---|',
      `| Wire size | ${wire.length} bytes (${report.size.marginTo1232} under 1,232; ${report.size.marginToOurBudget} under our ${MAX_TX_BYTES}) |`,
      `| Added by the wallet | ${added.length ? `${added.length} instruction(s), ${report.size.addedBytes} bytes (Lighthouse: ${report.size.lighthouseInstructions}, ${lighthouseBytes} bytes)` : 'nothing'} |`,
      `| Changed from our builder | ${changed.length ? changed.map((r) => `${r.kind.split('.')[1]}: ${r.summary}`).join('; ') : 'nothing'} |`,
      `| Compute | limit ${report.computeBudget.unitLimit ?? '-'}, price ${report.computeBudget.unitPriceMicroLamports ?? '-'} µlamports, used ${report.computeBudget.unitsConsumed ?? '-'} |`,
      `| Fee | ${meta?.fee ?? '-'} lamports |`,
      `| Executed | ${report.executed} |`,
      `| Allowlist (landed) | ${allowlist.ok ? 'pass' : `fail: ${allowlist.violations.join('; ')}`} |`,
      `| Allowlist (without additions) | ${allowlistWithoutAdded.ok ? 'pass' : `fail: ${allowlistWithoutAdded.violations.join('; ')}`} |`,
      '',
      '| # | Program | Instruction | Origin |',
      '|---|---|---|---|',
      ...rows.map((r) => `| ${r.index} | ${r.program} | ${r.summary.replace(/\|/g, '\\|')} | ${r.origin}${r.note ? ` (${r.note})` : ''} |`),
      '',
    ].join('\n');
    fs.writeFileSync(`${base}.md`, md);
    L();
    L(`  wrote ${base}.json and .md`);
  }
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(1);
});
