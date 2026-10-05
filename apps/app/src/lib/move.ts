// One move, end to end: checks → signed quote → allowlisted transaction → simulation →
// Phantom → deposit → status → arrival. Order and rules follow BUILD-PLAN §2.1–2.2.

import {
  APP_FEE_BPS,
  checkQuote,
  JupiterClient,
  makeQuoteRequest,
  MIN_SOLANA_ZEC_ZAT,
  minimumFromError,
  minimumWithFee,
  OneClickClient,
  OneClickError,
  prepareMove,
  simulateMove,
  USDC_MINT,
  WSOL_MINT,
  type JupiterQuote,
  type MoveKind,
  type QuoteRequest,
  type QuoteResponse,
} from '@zecdoor/solana';
import { newWallet } from '@zecdoor/zcash';
import type { PublicKey } from '@solana/web3.js';
import { QUOTE_KEY } from '../config';
import type { PhantomSolana } from './phantom';
import { isUserRejection } from './phantom';
import { withRpc } from './rpc';
import { geo, health, isSanctioned, reportMove } from './server';
import { getWallet, markAddressUsed, putMove, putWallet, deleteMove, type BrowserWallet, type MoveRecord } from './store';
import { latestHeight, ready, scanForArrival } from './zcash';
import { applyStatus } from './status';

export { applyStatus, refundReason } from './status';

export const oneClick = new OneClickClient();
export const jupiter = new JupiterClient();

export interface Destination {
  kind: 'browser' | 'own';
  address: string;
  /** Diversifier index in this browser's wallet; null for a pasted address. */
  index: number | null;
}

export type MoveErrorCode =
  | 'paused'
  | 'region'
  | 'topup_region'
  | 'sanctioned'
  | 'too_small'
  | 'price_moved'
  | 'no_sol'
  | 'no_route'
  | 'simulation'
  | 'cancelled'
  | 'rpc'
  | 'quote';

export class MoveError extends Error {
  constructor(
    readonly code: MoveErrorCode,
    message: string,
    readonly detail?: { minimum?: bigint; quote?: QuoteResponse },
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- previews

let preview: Promise<string> | null = null;
/**
 * Dry quotes need a valid recipient before the user has chosen one. A throwaway wallet made
 * in memory is used for that, so no real address of the user is named in a preview.
 */
export function previewRecipient(): Promise<string> {
  preview ??= ready().then(() => {
    const w = newWallet('main', 0);
    return import('@zecdoor/zcash').then((z) => z.addressAt(w.ufvk, 'main', 0));
  });
  return preview;
}

export interface DryQuote {
  sent: QuoteRequest;
  resp: QuoteResponse;
  at: number;
}

/** A signed dry quote (no deposit address). Throws MoveError('too_small') with the minimum. */
export async function dryQuote(kind: MoveKind, amount: bigint, owner: PublicKey, recipient?: string): Promise<DryQuote> {
  const sent = makeQuoteRequest({ kind, amount, recipient: recipient ?? (await previewRecipient()), refundTo: owner.toBase58(), dry: true });
  try {
    const resp = await oneClick.quote(sent);
    checkQuote(resp, sent, Date.now(), QUOTE_KEY);
    return { sent, resp, at: Date.now() };
  } catch (e) {
    throw toMoveError(e);
  }
}

function toMoveError(e: unknown): MoveError {
  if (e instanceof MoveError) return e;
  const min = minimumFromError(e);
  if (min !== null) return new MoveError('too_small', 'Below the bridge minimum.', { minimum: min });
  if (e instanceof OneClickError) {
    if (/liquidity/i.test(e.message)) return new MoveError('no_route', 'No route for this amount right now. Try a smaller amount.');
    return new MoveError('quote', `NEAR Intents: ${e.message}`);
  }
  if (e instanceof TypeError) return new MoveError('quote', 'Could not reach NEAR Intents. Check your connection and try again.');
  return new MoveError('quote', (e as Error).message);
}

/** The smallest Solana ZEC amount the bridge takes now (read from 1Click, fee included). */
export async function exitMinimum(owner: PublicKey): Promise<bigint> {
  try {
    await dryQuote('exit', 1n, owner);
  } catch (e) {
    if (e instanceof MoveError && e.detail?.minimum) return e.detail.minimum;
  }
  return minimumWithFee(MIN_SOLANA_ZEC_ZAT, APP_FEE_BPS.exit);
}

export interface TopUpPlan {
  target: bigint;
  need: bigint;
  payWith: 'sol' | 'usdc';
  swap: JupiterQuote;
  /** Most the user can pay (Jupiter's slippage bound), base units of SOL or USDC. */
  maxPay: bigint;
}

export async function planTopUp(balance: bigint, owner: PublicKey, payWith: 'sol' | 'usdc'): Promise<TopUpPlan> {
  const target = await exitMinimum(owner);
  const need = target - balance;
  if (need <= 0n) throw new MoveError('quote', 'Your balance already covers the minimum.');
  try {
    const swap = await jupiter.quoteExactOut({ inputMint: payWith === 'usdc' ? USDC_MINT : WSOL_MINT, outAmount: need });
    return { target, need, payWith, swap, maxPay: BigInt(swap.otherAmountThreshold) };
  } catch {
    throw new MoveError('no_route', 'The swap for the top-up is not available right now. Nothing was sent.');
  }
}

// ---------------------------------------------------------------- the move

export type Stage = 'checking' | 'quoting' | 'building' | 'signing' | 'sending';

export interface MoveRequest {
  kind: MoveKind;
  amount: bigint;
  dest: Destination;
  owner: PublicKey;
  provider: PhantomSolana;
  topUpWith?: 'sol' | 'usdc';
  /** The minimum output shown to the user; a real quote more than 1% worse is not signed. */
  shownMinOut?: bigint;
  paid?: MoveRecord['paid'];
  onStage?: (s: Stage) => void;
}

export async function executeMove(r: MoveRequest): Promise<MoveRecord> {
  const stage = r.onStage ?? (() => {});
  const owner = r.owner.toBase58();

  stage('checking');
  const [h, g, sanctioned, zcashFrom] = await Promise.all([
    health(),
    geo(),
    isSanctioned(owner),
    latestHeight().catch(() => null),
  ]);
  if (g && !g.allowed) throw new MoveError('region', 'ZecDoor is not offered where you are.');
  if (g && !g.topup && r.kind === 'topup') throw new MoveError('topup_region', 'Top-up is not offered where you are.');
  if (h?.paused) throw new MoveError('paused', h.message ?? 'NEAR Intents reports an incident. Nothing was sent.');
  if (sanctioned) throw new MoveError('sanctioned', 'This wallet cannot use ZecDoor.');

  stage('quoting');
  const sent = makeQuoteRequest({ kind: r.kind, amount: r.amount, recipient: r.dest.address, refundTo: owner, dry: false });
  let quote: QuoteResponse;
  try {
    quote = await oneClick.quote(sent);
    checkQuote(quote, sent, Date.now(), QUOTE_KEY);
  } catch (e) {
    throw toMoveError(e);
  }
  if (r.shownMinOut !== undefined && BigInt(quote.quote.minAmountOut) * 100n < r.shownMinOut * 99n) {
    throw new MoveError('price_moved', 'The price moved since you reviewed it. Check the new amount.', { quote });
  }

  stage('building');
  const prepared = await withRpc((c) =>
    prepareMove({ connection: c, kind: r.kind, owner: r.owner, quote, ...(r.topUpWith ? { topUpWith: r.topUpWith } : {}) }),
  ).catch((e) => {
    throw e instanceof MoveError ? e : new MoveError('rpc', (e as Error).message);
  });
  const sim = await withRpc((c) => simulateMove(c, prepared.tx, prepared.allowlist)).catch(() => null);
  if (!sim) throw new MoveError('rpc', 'Could not check the transaction on Solana. Nothing was sent.');
  if (!sim.ok) {
    const logs = sim.logs.join('\n');
    if (/insufficient (lamports|funds)/i.test(logs) || /InsufficientFunds/.test(JSON.stringify(sim.err))) {
      throw new MoveError('no_sol', 'Not enough SOL for Solana fees.');
    }
    throw new MoveError('simulation', 'This transaction would fail on Solana, so it was not offered for signing.');
  }
  if (sim.depositReceives !== BigInt(quote.quote.amountIn)) {
    throw new MoveError('simulation', 'The transaction would not deliver the quoted amount, so it was not offered for signing.');
  }

  const now = Date.now();
  const wallet = r.dest.kind === 'browser' ? await getWallet() : undefined;
  const record: MoveRecord = {
    depositAddress: quote.quote.depositAddress,
    kind: r.kind,
    createdAt: now,
    owner,
    amountIn: quote.quote.amountIn,
    amountOut: quote.quote.amountOut,
    minAmountOut: quote.quote.minAmountOut,
    ...(quote.quote.withdrawFee ? { withdrawFee: quote.quote.withdrawFee } : {}),
    recipient: r.dest.address,
    recipientIndex: r.dest.index,
    zcashFrom,
    quote,
    ...(r.paid ? { paid: r.paid } : {}),
    status: 'PENDING_DEPOSIT',
    updatedAt: now,
    statusSince: now,
    ...(wallet?.firstMovePending ? { firstWallet: true } : {}),
  };
  // Saved before signing, so a page closed mid-signature can still find the move.
  await putMove(record);

  stage('signing');
  let signature: string;
  try {
    ({ signature } = await r.provider.signAndSendTransaction(prepared.tx));
  } catch (e) {
    await deleteMove(record.depositAddress);
    if (isUserRejection(e)) throw new MoveError('cancelled', 'You cancelled in Phantom. Nothing was sent.');
    throw new MoveError('simulation', `Phantom could not send it: ${(e as Error).message}. Nothing was sent.`);
  }

  stage('sending');
  record.solanaSignature = signature;
  record.updatedAt = Date.now();
  await putMove(record);
  void oneClick.submitDeposit(signature, record.depositAddress);
  if (wallet && r.dest.index !== null) {
    await putWallet({ ...wallet, nextIndex: Math.max(wallet.nextIndex, r.dest.index + 1), firstMovePending: false });
  } else if (r.dest.kind === 'own') {
    await markAddressUsed(r.dest.address);
  }
  return record;
}

// ---------------------------------------------------------------- after signing

export async function refreshStatus(m: MoveRecord): Promise<MoveRecord> {
  const s = await oneClick.status(m.depositAddress);
  const next = applyStatus(m, s);
  await putMove(next);
  if (next.status === 'SUCCESS' && !next.counted) {
    if (await reportMove(next.depositAddress, next.kind, !!next.firstWallet)) {
      next.counted = true;
      await putMove(next);
    }
  }
  return next;
}

/** Looks for the shielded note with this browser's viewing key. Null until it is found. */
export async function checkArrival(m: MoveRecord, wallet: BrowserWallet, onProgress?: (h: number) => void): Promise<MoveRecord> {
  if (m.arrival || m.recipientIndex === null) return m;
  // Resume after the last scanned block (with a small overlap for reorgs).
  const start = m.zcashFrom ?? wallet.birthday;
  const from = m.scannedTo ? Math.max(start, m.scannedTo - 10) : start;
  const to = await latestHeight();
  if (to < from) return m;
  const found = await scanForArrival(
    {
      ufvk: wallet.ufvk,
      from,
      to,
      index: m.recipientIndex,
      minValue: Number(m.minAmountOut),
      // Matched on address index and amount only; whether the txid also matches the
      // bridge's is recorded below (byte order to be confirmed on the B1 mainnet run).
    },
    onProgress,
  );
  if (!found) {
    const next = { ...m, scannedTo: to };
    await putMove(next);
    return next;
  }
  const next: MoveRecord = {
    ...m,
    arrival: {
      height: found.height,
      txid: found.txid,
      value: found.value,
      pool: found.pool,
      foundAt: Date.now(),
      ...(m.zcashTxid ? { txidMatches: found.txid === m.zcashTxid } : {}),
    },
    completedAt: m.completedAt ?? Date.now(),
  };
  await putMove(next);
  return next;
}
