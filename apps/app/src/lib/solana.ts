// Reads the connected wallet's balances and the costs a move adds on Solana.

import { ata, tokenAccountAmount, USDC_MINT, ZEC_MINT } from '@zecdoor/solana';
import type { PublicKey } from '@solana/web3.js';
import { withRpc } from './rpc';

export interface Balances {
  zec: bigint;
  usdc: bigint;
  sol: bigint;
  hasZecAccount: boolean;
  at: number;
}

export async function readBalances(owner: PublicKey): Promise<Balances> {
  rentRead ??= refreshRent().catch(() => {
    rentRead = null;
  });
  await rentRead;
  return withRpc(async (c) => {
    const [infos, sol] = await Promise.all([
      c.getMultipleAccountsInfo([ata(ZEC_MINT, owner), ata(USDC_MINT, owner)], 'confirmed'),
      c.getBalance(owner, 'confirmed'),
    ]);
    return {
      zec: tokenAccountAmount(infos[0]?.data),
      usdc: tokenAccountAmount(infos[1]?.data),
      sol: BigInt(sol),
      hasZecAccount: !!infos[0],
      at: Date.now(),
    };
  });
}

/**
 * Rent-exempt minimums, read live (they changed: 1,488,440 lamports for a 165-byte token
 * account and 650,240 for a wallet on 5 Oct 2026, down from 2,039,280 and 890,880).
 * These defaults are only used until the first live read.
 */
export const rent = { tokenAccount: 1_488_440n, wallet: 650_240n };

async function refreshRent(): Promise<void> {
  const [t, w] = await withRpc((c) => Promise.all([c.getMinimumBalanceForRentExemption(165), c.getMinimumBalanceForRentExemption(0)]));
  rent.tokenAccount = BigInt(t);
  rent.wallet = BigInt(w);
}
let rentRead: Promise<void> | null = null;

/** Base fee (5,000) plus our priority fee at the compute limits in @zecdoor/solana, rounded up. */
export const TX_FEE = 15_000n;

/**
 * SOL the move needs beyond what it sends. The deposit address's ZEC/USDC token account is
 * created and paid for by the user (it is new for every quote); a SOL top-up also briefly
 * holds wrapped SOL in an account that is closed in the same transaction.
 */
export function solNeeded(kind: 'exit' | 'topup' | 'buyUsdc' | 'buySol', o: { swapLamports?: bigint; hasZecAccount?: boolean } = {}): bigint {
  switch (kind) {
    case 'exit':
    case 'buyUsdc':
      return TX_FEE + rent.tokenAccount;
    case 'topup':
      return TX_FEE + rent.tokenAccount * (o.hasZecAccount === false ? 3n : 2n) + (o.swapLamports ?? 0n);
    case 'buySol':
      return TX_FEE + rent.wallet;
  }
}
