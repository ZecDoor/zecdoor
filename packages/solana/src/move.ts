// Turns a checked 1Click quote into the one transaction the user signs, and refuses to hand
// back anything the allowlist rejects.

import { AddressLookupTableAccount, Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { assertAllowed, type AllowlistContext } from './allowlist.js';
import {
  ata,
  buySolInstructions,
  buyUsdcInstructions,
  compile,
  COMPUTE_UNITS,
  exitInstructions,
  MAX_TX_BYTES,
  topUpInstructions,
  type MoveContext,
} from './build.js';
import { USDC_MINT, WSOL_MINT, ZEC_MINT } from './constants.js';
import { JupiterClient, type JupiterQuote } from './jupiter.js';
import type { MoveKind, QuoteResponse } from './oneclick.js';

export interface PreparedMove {
  tx: VersionedTransaction;
  allowlist: AllowlistContext;
  bytes: number;
  /** Top-up only: the Jupiter quote, so the UI can show the SOL spent. */
  swap?: JupiterQuote;
}

export interface PrepareOptions {
  connection: Connection;
  kind: MoveKind;
  owner: PublicKey;
  /** A quote that has passed `checkQuote`. */
  quote: QuoteResponse;
  /** Exit only: close the user's ZEC account when the move empties it. */
  closeEmptied?: boolean;
  jupiter?: JupiterClient;
  /** Top-up only: what the user pays the difference with. */
  topUpWith?: 'sol' | 'usdc';
  /** Micro-lamports per compute unit. */
  computeUnitPrice?: number;
}

export async function lookupTables(connection: Connection, addresses: string[]): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const a of addresses) {
    const r = await connection.getAddressLookupTable(new PublicKey(a));
    if (!r.value) throw new Error(`Lookup table ${a} not found`);
    out.push(r.value);
  }
  return out;
}

/** The user's Solana ZEC balance in base units (0 when the account does not exist). */
export async function zecBalance(connection: Connection, owner: PublicKey): Promise<bigint> {
  // A missing account is 0; a network error must throw, never read as an empty balance.
  const info = await connection.getAccountInfo(ata(ZEC_MINT, owner), 'confirmed');
  return tokenAccountAmount(info?.data);
}

/** The amount field of an SPL token account (offset 64), or 0 for no account. */
export const tokenAccountAmount = (data: Uint8Array | null | undefined): bigint =>
  data && data.length >= 72 ? new DataView(data.buffer, data.byteOffset + 64, 8).getBigUint64(0, true) : 0n;

export async function prepareMove(o: PrepareOptions): Promise<PreparedMove> {
  const depositAddress = o.quote.quote.depositAddress;
  if (!depositAddress) throw new Error('Quote has no deposit address');
  const ctx: MoveContext = {
    kind: o.kind,
    owner: o.owner,
    depositAddress: new PublicKey(depositAddress),
    amountIn: BigInt(o.quote.quote.amountIn),
  };

  let instructions;
  let tables: AddressLookupTableAccount[] = [];
  let swap: JupiterQuote | undefined;
  let maxWrapLamports: bigint | undefined;

  switch (o.kind) {
    case 'exit':
      instructions = exitInstructions(ctx, { closeEmptied: o.closeEmptied ?? false });
      break;
    case 'buyUsdc':
      instructions = buyUsdcInstructions(ctx);
      break;
    case 'buySol':
      instructions = buySolInstructions(ctx);
      break;
    case 'topup': {
      const have = await zecBalance(o.connection, o.owner);
      const need = ctx.amountIn - have;
      if (need <= 0n) throw new Error('Balance already covers the move; use a plain exit');
      const jup = o.jupiter ?? new JupiterClient();
      const inputMint = o.topUpWith === 'usdc' ? USDC_MINT : WSOL_MINT;
      swap = await jup.quoteExactOut({ inputMint, outAmount: need });
      const ixs = await jup.swapInstructions(swap, o.owner);
      tables = await lookupTables(o.connection, ixs.lookupTables);
      // Jupiter wraps at most the quote's maximum input; USDC needs no wrapping.
      maxWrapLamports = inputMint.equals(WSOL_MINT) ? BigInt(swap.otherAmountThreshold) : 0n;
      instructions = topUpInstructions(ctx, ixs);
      break;
    }
  }

  const { blockhash } = await o.connection.getLatestBlockhash('confirmed');
  const tx = compile({
    payer: o.owner,
    instructions,
    blockhash,
    lookupTables: tables,
    computeUnits: COMPUTE_UNITS[o.kind],
    ...(o.computeUnitPrice !== undefined ? { computeUnitPrice: o.computeUnitPrice } : {}),
  });

  const allowlist: AllowlistContext = {
    kind: o.kind,
    owner: o.owner,
    depositAddress: ctx.depositAddress,
    amountIn: ctx.amountIn,
    lookupTables: tables,
    ...(maxWrapLamports !== undefined ? { maxWrapLamports } : {}),
  };
  assertAllowed(tx, allowlist);

  const bytes = tx.serialize().length;
  if (bytes > MAX_TX_BYTES) throw new Error(`Transaction is ${bytes} bytes; the limit is ${MAX_TX_BYTES}`);
  return { tx, allowlist, bytes, ...(swap ? { swap } : {}) };
}
