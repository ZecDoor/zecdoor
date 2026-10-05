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

/** Rent for one SPL token account (165 bytes): 2,039,280 lamports on mainnet. */
export const TOKEN_ACCOUNT_RENT = 2_039_280n;
/** A wallet must keep at least this much SOL after a transfer (rent-exempt minimum). */
export const WALLET_RESERVE = 890_880n;
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
      return TX_FEE + TOKEN_ACCOUNT_RENT;
    case 'topup':
      return TX_FEE + TOKEN_ACCOUNT_RENT * (o.hasZecAccount === false ? 3n : 2n) + (o.swapLamports ?? 0n);
    case 'buySol':
      return TX_FEE + WALLET_RESERVE;
  }
}
