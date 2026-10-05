// Turns 1Click's status replies into the move record the screens read. Pure, so it is unit-tested.

import type { StatusResponse } from '@zecdoor/solana';
import type { MoveRecord } from './store';

export function applyStatus(m: MoveRecord, s: StatusResponse, now = Date.now()): MoveRecord {
  const next: MoveRecord = { ...m, updatedAt: now };
  if (s.status !== m.status) {
    next.status = s.status;
    next.statusSince = now;
  }
  const d = s.swapDetails;
  // explorerUrl comes back empty (live, 4 Oct 2026), so hashes are told apart by format:
  // a Zcash txid is 64 hex characters, a Solana signature is base58.
  const isZcashTxid = (h: string) => /^[0-9a-f]{64}$/i.test(h);
  const zTx = d?.destinationChainTxHashes?.find((h) => isZcashTxid(h.hash))?.hash;
  if (zTx) next.zcashTxid = zTx.toLowerCase();
  if (s.status === 'REFUNDED' || s.status === 'INCOMPLETE_DEPOSIT') {
    // Where 1Click lists the refund transaction is not documented (UNVERIFIED until we see
    // a real refund): take any Solana signature that is not the user's own deposit.
    const hashes = [...(d?.originChainTxHashes ?? []), ...(d?.destinationChainTxHashes ?? [])];
    const refundTx = hashes.find((h) => !isZcashTxid(h.hash) && h.hash !== m.solanaSignature)?.hash;
    next.refund = {
      ...(d?.refundReason ? { reason: d.refundReason } : {}),
      ...(d?.refundedAmount ? { amount: d.refundedAmount } : {}),
      ...(d?.refundFee ? { fee: d.refundFee } : {}),
      ...(refundTx ? { txid: refundTx } : {}),
    };
  }
  if (s.status === 'SUCCESS' && m.recipientIndex === null && !next.completedAt) next.completedAt = now;
  return next;
}

/** Plain-language reasons for refunds 1Click reports (research p1-oneclick §A.4–A.5). */
export function refundReason(code?: string): string {
  if (!code) return 'The bridge could not complete the move';
  if (/MIN_AMOUNT_OUT|SLIPPAGE/i.test(code)) return 'The price moved past the quote’s limit';
  if (/PARTIAL|LESS/i.test(code)) return 'The deposit was smaller than the quote';
  if (/MORE_THAN/i.test(code)) return 'More than the quoted amount arrived';
  if (/LIQUIDITY/i.test(code)) return 'Not enough liquidity on the route';
  if (/DEADLINE|EXPIRED/i.test(code)) return 'The quote expired before the deposit arrived';
  return code.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
