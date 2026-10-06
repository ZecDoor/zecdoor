// Builds the one Solana transaction a user signs for each kind of move. Every transaction
// moves value only from the user's own accounts to the 1Click deposit address named in a
// checked quote (plus, for the top-up, a Jupiter swap into the user's own ZEC account).
// `checkTransaction` (allowlist.ts) enforces this on the compiled transaction.

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { USDC_DECIMALS, USDC_MINT, ZEC_DECIMALS, ZEC_MINT } from './constants.js';
import type { JupiterSwap } from './jupiter.js';
import type { MoveKind } from './oneclick.js';

export interface MoveContext {
  kind: MoveKind;
  owner: PublicKey;
  depositAddress: PublicKey;
  /** Exactly `quote.amountIn`. */
  amountIn: bigint;
}

export const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

function tokenDeposit(ctx: MoveContext, mint: PublicKey, decimals: number): TransactionInstruction[] {
  const depositAta = ata(mint, ctx.depositAddress);
  return [
    createAssociatedTokenAccountIdempotentInstruction(ctx.owner, depositAta, ctx.depositAddress, mint),
    createTransferCheckedInstruction(ata(mint, ctx.owner), mint, depositAta, ctx.owner, ctx.amountIn, decimals),
  ];
}

/** Exit: send exactly `amountIn` of Solana ZEC to the deposit address. */
export function exitInstructions(ctx: MoveContext, opts: { closeEmptied?: boolean } = {}): TransactionInstruction[] {
  return [
    ...tokenDeposit(ctx, ZEC_MINT, ZEC_DECIMALS),
    // Only when the whole balance leaves: returns the account's rent to the user. Off by
    // default for holders who still receive ZEC payouts (research p1-topup §A2).
    ...(opts.closeEmptied ? [createCloseAccountInstruction(ata(ZEC_MINT, ctx.owner), ctx.owner, ctx.owner)] : []),
  ];
}

/** Top-up: Jupiter ExactOut swap into the user's ZEC account, then the exit transfer. */
export function topUpInstructions(ctx: MoveContext, swap: JupiterSwap): TransactionInstruction[] {
  return [...swap.setup, swap.swap, ...swap.cleanup, ...tokenDeposit(ctx, ZEC_MINT, ZEC_DECIMALS)];
}

/** Buy with USDC: send exactly `amountIn` USDC to the deposit address. */
export function buyUsdcInstructions(ctx: MoveContext): TransactionInstruction[] {
  return tokenDeposit(ctx, USDC_MINT, USDC_DECIMALS);
}

/** Buy with SOL: a plain transfer of `amountIn` lamports (how real SOL deposits look). */
export function buySolInstructions(ctx: MoveContext): TransactionInstruction[] {
  return [SystemProgram.transfer({ fromPubkey: ctx.owner, toPubkey: ctx.depositAddress, lamports: ctx.amountIn })];
}

export interface CompileOptions {
  payer: PublicKey;
  instructions: TransactionInstruction[];
  blockhash: string;
  lookupTables?: AddressLookupTableAccount[];
  computeUnits?: number;
  /** Micro-lamports per compute unit. */
  computeUnitPrice?: number;
}

export function compile(o: CompileOptions): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: o.payer,
    recentBlockhash: o.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: o.computeUnits ?? 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.computeUnitPrice ?? 20_000 }),
      ...o.instructions,
    ],
  }).compileToV0Message(o.lookupTables ?? []);
  return new VersionedTransaction(message);
}

/** Compute-unit limits that cover each kind with margin (simulated 15k–255k, research e4 §1a). */
export const COMPUTE_UNITS: Record<MoveKind, number> = { exit: 60_000, topup: 350_000, buyUsdc: 60_000, buySol: 20_000 };

/**
 * Phantom may append Lighthouse checks after its own simulation; stay under this many bytes so they
 * fit in Solana's 1,232. Measured on mainnet (scripts/mainnet/inspect-landed.ts): the first check
 * costs about 62 bytes (its program id is a static key), each further one about 24; a four-check
 * guard is 134. 1,060 leaves 172.
 */
export const MAX_TX_BYTES = 1060;
/** Jupiter route sizes tried in turn for a top-up, until the transaction fits MAX_TX_BYTES. */
export const TOPUP_MAX_ACCOUNTS = [24, 16] as const;
