import { PublicKey } from '@solana/web3.js';

/** NEAR-Omni-bridged ZEC on Solana (SPL Token, 8 decimals). */
export const ZEC_MINT = new PublicKey('A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS');
export const ZEC_DECIMALS = 8;
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const USDC_DECIMALS = 6;
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
export const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
/** Jupiter Aggregator v6 (Metis). Used only for the small-balance top-up swap. */
export const JUPITER_PROGRAM = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

/** NEAR Intents 1Click asset ids (from `GET /v0/tokens`). */
export const ASSET = {
  solanaZec: '1cs_v1:sol:spl:A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
  solanaUsdc: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
  sol: 'nep141:sol.omft.near',
  zec: 'nep141:zec.omft.near',
} as const;

/** 1Click's minimum for Solana ZEC → ZEC with no app fee ("try at least 133334"). */
export const MIN_SOLANA_ZEC_ZAT = 133_334n;

/**
 * The app fee comes off before the bridge minimum is checked, so the minimum 1Click suggests
 * becomes ceil(min / (1 − fee)): 133,669 zat at 25 bps ("try at least 133669", live 5 Oct 2026).
 * The suggestion is padded: the lowest amounts 1Click actually accepted that day were 133,011
 * (no fee) and 133,345 (25 bps). ZecDoor uses the suggested figure, re-read at run time.
 */
export const minimumWithFee = (min: bigint, bps: number): bigint => {
  const keep = 10_000n - BigInt(bps);
  return (min * 10_000n + keep - 1n) / keep;
};

/**
 * App fees (decision D2), in basis points of the input. On Solana ZEC → ZEC we keep all of
 * it; on USDC and SOL buys 1Click splits it 50/50 (research p1-oneclick §C).
 */
export const APP_FEE_BPS = { exit: 25, topup: 25, buyUsdc: 50, buySol: 50 } as const;

/**
 * NEAR implicit account that receives ZecDoor's app fees inside `intents.near`.
 * The key is held offline by the operator; it is never used by the app.
 */
export const FEE_RECIPIENT = '0b419bed99105b07bdcdd9b9f7a6b549fd9d1aab5ac062adbd3725cd6be24a56';

/** Ed25519 key 1Click signs quotes with (one-click-sdk-typescript 0.1.26). */
export const ONE_CLICK_SIGNING_KEY = 'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';
export const ONE_CLICK_API = 'https://1click.chaindefuser.com';
export const JUPITER_API = 'https://lite-api.jup.ag/swap/v1';
