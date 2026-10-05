// Fee self-test. NEAR can change the fee terms for unregistered apps "at any time on a
// prospective basis" (1Click ToS Schedule 1 §2.2), and the USDC/SOL split we observe differs
// from NEAR's docs (research p1-oneclick §C.2). The server runs this at start-up and on a
// schedule; when it fails, the app stops offering the affected moves until we review.

import { APP_FEE_BPS, FEE_RECIPIENT } from './constants.js';
import { makeQuoteRequest, OneClickClient, type MoveKind } from './oneclick.js';

/** Fee rows we expect 1Click to echo for our requested fee (observed live, 5 Oct 2026). */
export const EXPECTED_FEE_ROWS: Record<MoveKind, { ours: number; total: number }> = {
  exit: { ours: APP_FEE_BPS.exit, total: APP_FEE_BPS.exit },
  topup: { ours: APP_FEE_BPS.topup, total: APP_FEE_BPS.topup },
  buyUsdc: { ours: APP_FEE_BPS.buyUsdc / 2, total: APP_FEE_BPS.buyUsdc },
  buySol: { ours: APP_FEE_BPS.buySol / 2, total: APP_FEE_BPS.buySol },
};

/** Amounts large enough to clear every minimum: 0.05 ZEC, 50 USDC, 0.4 SOL. */
const PROBE_AMOUNT: Record<Exclude<MoveKind, 'topup'>, bigint> = {
  exit: 5_000_000n,
  buyUsdc: 50_000_000n,
  buySol: 400_000_000n,
};

export interface FeeCheck {
  kind: MoveKind;
  ok: boolean;
  requested: number;
  ours: number;
  total: number;
  rows: Array<{ recipient: string; fee: number }>;
  error?: string;
}

/** Dry quotes only: nothing is deposited. `recipient` is any valid Orchard-capable UA. */
export async function feeSelfTest(o: { recipient: string; refundTo: string; client?: OneClickClient }): Promise<FeeCheck[]> {
  const client = o.client ?? new OneClickClient();
  const kinds = Object.keys(PROBE_AMOUNT) as Array<keyof typeof PROBE_AMOUNT>;
  return Promise.all(
    kinds.map(async (kind): Promise<FeeCheck> => {
      const requested = APP_FEE_BPS[kind];
      try {
        const req = makeQuoteRequest({ kind, amount: PROBE_AMOUNT[kind], recipient: o.recipient, refundTo: o.refundTo, dry: true });
        const r = await client.quote(req);
        const rows = (r.quoteRequest.appFees ?? []).map(({ recipient, fee }) => ({ recipient, fee }));
        const ours = rows.filter((f) => f.recipient === FEE_RECIPIENT).reduce((s, f) => s + f.fee, 0);
        const total = rows.reduce((s, f) => s + f.fee, 0);
        const want = EXPECTED_FEE_ROWS[kind];
        return { kind, ok: ours === want.ours && total === want.total, requested, ours, total, rows };
      } catch (e) {
        return { kind, ok: false, requested, ours: 0, total: 0, rows: [], error: (e as Error).message };
      }
    }),
  );
}
