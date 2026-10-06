// What one move costs, as a fixed amount, so a balance can be judged worth moving or not. The same
// formula as scripts/stats/solana-zec-holders.mjs, which produces the published holder tiers.

import { APP_FEE_BPS } from '@zecdoor/solana';
import { rent, TX_FEE } from './solana';

/** The bridge's payout fee as quoted (a ceiling: our first move paid less). Used until a quote gives it. */
export const QUOTED_PAYOUT_FEE_ZAT = 32_000n;
/** The top-up's Jupiter slippage bound, in basis points. */
const SLIPPAGE_BPS = 100n;

export interface MovingCost {
  /** Total fixed cost of one move, in zat. */
  zat: bigint;
  payoutFee: bigint;
  solana: bigint;
  ourFee: bigint;
  slippage: bigint;
}

/**
 * Fixed costs of moving a balance below the minimum with the top-up: the bridge's payout fee, the deposit
 * account's rent and the Solana fee (converted at NEAR Intents' prices), our fee and the swap's slippage
 * bound, both on the minimum. Null until prices are known.
 */
export function movingCost(minimum: bigint, p: { zec?: number; sol?: number }, payoutFee = QUOTED_PAYOUT_FEE_ZAT): MovingCost | null {
  if (!p.zec || !p.sol) return null;
  const lamports = rent.tokenAccount + TX_FEE;
  const solana = (lamports * BigInt(Math.round(p.sol * 1e6))) / BigInt(Math.round(p.zec * 1e6)) / 10n;
  const ourFee = (minimum * BigInt(APP_FEE_BPS.topup)) / 10_000n;
  const slippage = (minimum * SLIPPAGE_BPS) / 10_000n;
  return { zat: payoutFee + solana + ourFee + slippage, payoutFee, solana, ourFee, slippage };
}
