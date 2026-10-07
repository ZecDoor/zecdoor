// The public proof of our first mainnet move (B1, docs/testing). Three of its four checks are run again
// by the visitor's browser against public sources: NEAR Intents' own record and quote signature, the
// Solana transaction from a public RPC, and the Zcash transaction's block from lightwalletd. The fourth,
// the note found with the wallet's viewing key, is the recorded result: publishing that key would show
// every payment the wallet ever receives.

import { verifyQuoteSignature, ZEC_MINT, type StatusResponse } from '@zecdoor/solana';
import { LIGHTWALLETD, SOLANA_RPCS } from '../config';
import { oneClick } from './move';

export const B1 = {
  date: '5 Oct 2026',
  depositAddress: '6HVDicNC2ureqoJHHyJ6PmRjE82pTAiJhPZVNQTWdTbe',
  solanaSignature: '2ZfeRtsivSk7UCrsTenJ5dL1GoArXyK2aCRH1RE8uFUR6XMEgjvVBLtc1JWnigb44FBTbauSvqc3xtBUmJJ9ZQLa',
  zcashTxid: '2fac74310c294c306f56bb9d60891af9d0f8f2ff9c4244f77e1939cf7df206d6',
  zcashHeight: 3_507_539,
  startedWith: 30_000n,
  sent: 133_669n,
  found: 108_335n,
  birthday: 3_507_524,
  elapsed: '2 min 13 s',
} as const;

export interface QuoteCheck {
  status: StatusResponse['status'];
  signatureValid: boolean;
  /** The quote names this deposit address and NEAR Intents lists our Solana transaction as the deposit. */
  matches: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: string;
  zcashTxid: string | null;
}

/** NEAR Intents' own record of the move, with the quote it signed, verified against its public key here. */
export async function checkQuote(depositAddress = B1.depositAddress): Promise<QuoteCheck> {
  const s = await oneClick.status(depositAddress, AbortSignal.timeout(15_000));
  const q = s.quoteResponse;
  if (!q) throw new Error('NEAR Intents returned no quote for this move.');
  const d = s.swapDetails;
  const zcashTxid = d?.destinationChainTxHashes?.find((h) => /^[0-9a-f]{64}$/i.test(h.hash))?.hash.toLowerCase() ?? null;
  return {
    status: s.status,
    signatureValid: verifyQuoteSignature(q),
    matches: q.quote.depositAddress === depositAddress && !!d?.originChainTxHashes?.some((h) => h.hash === B1.solanaSignature),
    amountIn: BigInt(q.quote.amountIn),
    minAmountOut: BigInt(q.quote.minAmountOut),
    recipient: q.quoteRequest.recipient,
    zcashTxid,
  };
}

export interface SolanaCheck {
  succeeded: boolean;
  /** ZEC the deposit address received in this transaction, in zat. */
  deposited: bigint;
  blockTime: number | null;
}

interface TokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/**
 * The transaction from a public Solana RPC. Not every endpoint keeps history (rpc.solanatracker.io answers
 * null, 7 Oct 2026), so each is tried until one returns it; public endpoints rate-limit, so up to three rounds.
 */
export async function checkSolana(signature = B1.solanaSignature, depositAddress = B1.depositAddress): Promise<SolanaCheck> {
  let last: unknown = null;
  for (let round = 0; round < 3; round++) {
    if (round) await new Promise((r) => setTimeout(r, 1500 * round));
    const found = await readSolana(signature, depositAddress).catch((e: unknown) => ((last = e), null));
    if (found) return found;
  }
  throw new Error(last ? 'The Solana RPCs did not answer. Try again in a minute.' : 'No public Solana RPC returned this transaction.');
}

async function readSolana(signature: string, depositAddress: string): Promise<SolanaCheck | null> {
  let last: unknown = null;
  for (const url of SOLANA_RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json()) as { result?: { blockTime: number | null; meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } } | null };
      const tx = j.result;
      if (!tx) continue;
      const mint = ZEC_MINT.toBase58();
      const amount = (list?: TokenBalance[]) => BigInt(list?.find((b) => b.mint === mint && b.owner === depositAddress)?.uiTokenAmount.amount ?? '0');
      return {
        succeeded: tx.meta.err === null,
        deposited: amount(tx.meta.postTokenBalances) - amount(tx.meta.preTokenBalances),
        blockTime: tx.blockTime,
      };
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
  return null;
}

/** The block holding the Zcash transaction, from lightwalletd (zec.rocks). */
export async function checkZcash(txid = B1.zcashTxid): Promise<number | null> {
  const { GrpcWebSource } = await import('@zecdoor/zcash');
  return new GrpcWebSource(LIGHTWALLETD).transactionHeight(txid, AbortSignal.timeout(15_000));
}
