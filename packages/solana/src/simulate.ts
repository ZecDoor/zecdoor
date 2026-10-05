// Read-only simulation of a prepared move: runs it against current mainnet state without a
// signature and reports what the deposit address would receive. Nothing is sent.

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import type { AllowlistContext } from './allowlist.js';
import { ata } from './build.js';
import { USDC_MINT, ZEC_MINT } from './constants.js';
import { tokenAccountAmount } from './move.js';

export interface SimulationReport {
  ok: boolean;
  err: unknown;
  logs: string[];
  unitsConsumed: number | undefined;
  /** What the deposit address (or its token account) gains, in base units. */
  depositReceives: bigint;
  bytes: number;
}


/** The account whose balance shows the deposit: the deposit's token account, or itself for SOL. */
export function depositWatch(ctx: Pick<AllowlistContext, 'kind' | 'depositAddress'>): { address: PublicKey; token: boolean } {
  if (ctx.kind === 'buySol') return { address: ctx.depositAddress, token: false };
  return { address: ata(ctx.kind === 'buyUsdc' ? USDC_MINT : ZEC_MINT, ctx.depositAddress), token: true };
}

export async function simulateMove(connection: Connection, tx: VersionedTransaction, ctx: AllowlistContext): Promise<SimulationReport> {
  const watch = depositWatch(ctx);
  const before = await connection.getAccountInfo(watch.address, 'confirmed');
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: [watch.address.toBase58()] },
  });
  const after = sim.value.accounts?.[0];
  const afterData = after?.data[0] ? Uint8Array.from(atob(after.data[0]), (c) => c.charCodeAt(0)) : null;
  const depositReceives = watch.token
    ? tokenAccountAmount(afterData) - tokenAccountAmount(before?.data)
    : BigInt(after?.lamports ?? 0) - BigInt(before?.lamports ?? 0);
  return {
    ok: sim.value.err === null,
    err: sim.value.err,
    logs: sim.value.logs ?? [],
    unitsConsumed: sim.value.unitsConsumed,
    depositReceives,
    bytes: tx.serialize().length,
  };
}
