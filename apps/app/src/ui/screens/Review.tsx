import { FEE_RECIPIENT } from '@zecdoor/solana';
import { useCallback, useEffect, useState } from 'react';
import { QUOTE_FRESH_MS, TERMS_URL } from '../../config';
import { clock, short, sol, usdc, zec } from '../../lib/format';
import { dryQuote, executeMove, MoveError, type DryQuote, type Stage } from '../../lib/move';
import { solNeeded } from '../../lib/solana';
import { AsideBox, AsideHead, BackBar, CheckCircle, Rows, Shell, Spinner, StateCard } from '../parts';
import { go } from '../router';
import { useApp } from '../state';

const STAGE_TEXT: Record<Stage, string> = {
  checking: 'Checking the bridge…',
  quoting: 'Getting your signed quote…',
  building: 'Building and checking the transaction…',
  signing: 'Confirm in Phantom…',
  sending: 'Sending…',
};

export function Review() {
  const app = useApp();
  const { draft, owner, provider, balances } = app;
  const [dry, setDry] = useState<DryQuote | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<MoveError | null>(null);

  const load = useCallback(() => {
    if (!draft?.dest || !owner) return;
    setDry(null);
    setError(null);
    dryQuote(draft.kind, draft.amount, owner, draft.dest.address)
      .then(setDry)
      .catch((e: unknown) => setError(e instanceof MoveError ? e : new MoveError('quote', String(e))));
  }, [draft, owner]);

  useEffect(() => {
    if (!draft?.dest) go('/', true);
    else load();
  }, [draft, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!draft?.dest || !owner || !provider) return null;
  const dest = draft.dest;
  const left = dry ? QUOTE_FRESH_MS - (now - dry.at) : QUOTE_FRESH_MS;
  const expired = !!dry && left <= 0;
  const q = dry?.resp.quote;

  const sendLabel =
    draft.kind === 'buyUsdc' ? usdc(draft.amount) : draft.kind === 'buySol' ? sol(draft.amount) : zec(draft.amount);
  const fees = dry?.resp.quoteRequest.appFees ?? [];
  const ourBps = fees.filter((f) => f.recipient === FEE_RECIPIENT).reduce((s, f) => s + f.fee, 0);
  const theirBps = fees.filter((f) => f.recipient !== FEE_RECIPIENT).reduce((s, f) => s + f.fee, 0);
  const feeOf = (bps: number) => {
    const v = (draft.amount * BigInt(bps)) / 10_000n;
    return draft.kind === 'buyUsdc' ? usdc(v) : draft.kind === 'buySol' ? sol(v) : zec(v, 0);
  };
  const solCost = solNeeded(draft.kind, {
    ...(draft.topUp?.payWith === 'sol' ? { swapLamports: draft.topUp.maxPay } : {}),
    hasZecAccount: balances?.hasZecAccount ?? true,
  });
  const needSol = draft.kind === 'buySol' ? solCost + draft.amount : solCost;
  const noSol = !!balances && balances.sol < needSol;
  const busy = stage !== null;

  const sign = async () => {
    if (!dry || expired || busy) return;
    setError(null);
    try {
      const record = await executeMove({
        kind: draft.kind,
        amount: draft.amount,
        dest,
        owner,
        provider,
        shownMinOut: BigInt(dry.resp.quote.minAmountOut),
        ...(draft.topUp ? { topUpWith: draft.topUp.payWith } : {}),
        ...(draft.pay ? { paid: { amount: draft.pay.amount.toString(), symbol: draft.pay.symbol } } : {}),
        onStage: setStage,
      });
      await Promise.all([app.reloadMoves(), app.reloadWallet()]);
      app.setDraft(null);
      go(`/move/${record.depositAddress}`, true);
    } catch (e) {
      const err = e instanceof MoveError ? e : new MoveError('simulation', (e as Error).message);
      setError(err);
      if (err.code === 'price_moved') load();
    } finally {
      setStage(null);
    }
  };

  return (
    <Shell
      aside={
        <>
          <AsideHead>What you are signing</AsideHead>
          <p>One Solana transaction. Before Phantom sees it, this page checks that it only sends {sendLabel} from your wallet to the deposit address in NEAR Intents’ signed quote{draft.kind === 'topup' ? ', after a Jupiter swap into your own account' : ''}.</p>
          <AsideBox title="If it can’t complete">
            <span>NEAR Intents refunds the wallet that sent it. Nobody at ZecDoor ever holds the funds.</span>
          </AsideBox>
        </>
      }
    >
      <BackBar title="Review" back={() => history.back()} />
      {dry && !expired ? (
        <span className="mono muted" style={{ fontSize: 13, marginTop: -12, textAlign: 'right' }}>
          Quote valid {clock(left)}
        </span>
      ) : null}

      <div className="card" style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label">You send · Solana</span>
          <span className="amount md">{sendLabel}</span>
          {draft.topUp ? (
            <span className="label">
              including up to {draft.topUp.payWith === 'sol' ? sol(draft.topUp.maxPay) : usdc(draft.topUp.maxPay)} swapped into ZEC
            </span>
          ) : null}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label">Arrives shielded · Zcash Ironwood</span>
          <span className="amount md">{q ? `≥ ${zec(BigInt(q.minAmountOut), 0)}` : '—'}</span>
        </div>
      </div>

      {!dry && !error ? <Spinner label="Getting a signed quote from NEAR Intents…" /> : null}

      {dry ? (
        <dl className="rows">
          {(
            [
              ['To', `${short(dest.address, 4, 4)} · ${dest.kind === 'browser' ? 'new address in this browser' : 'your wallet'}`],
              ['Bridge network fee', q?.withdrawFee ? zec(BigInt(q.withdrawFee), 0) : '—'],
              [`Our fee (${ourBps / 100}%)`, feeOf(ourBps)],
              ...(theirBps ? ([[`NEAR Intents fee (${theirBps / 100}%)`, feeOf(theirBps)]] as Array<[string, string]>) : []),
              ['Solana fees and deposits', `≈ ${sol(solCost)}`],
              ['Usually arrives', draft.kind === 'exit' || draft.kind === 'topup' ? '3–9 min' : `about ${Math.max(1, Math.round((q?.timeEstimate ?? 180) / 60))}–9 min`],
              ['If it can’t complete', `refund to ${short(owner.toBase58(), 4, 3)}`],
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Quote</dt>
            <dd className="ok" style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--sans)' }}>
              <CheckCircle />
              Signed by NEAR Intents · checked
            </dd>
          </div>
        </dl>
      ) : null}

      {expired ? (
        <StateCard tone="info" title="Quote expired" tag="Before signing" action="Get a new quote" onAction={load}>
          Prices moved while this screen was open. Nothing was sent.
        </StateCard>
      ) : null}
      {noSol && !error ? (
        <StateCard tone="warn" title="Not enough SOL for fees" tag="Before signing" action="Check again" onAction={() => void app.refreshBalances()}>
          You need about {sol(needSol)} for this move{draft.kind === 'buySol' ? '' : ': Solana fees plus a one-time token account for the bridge’s deposit address'}. Add SOL in Phantom, then come back.
        </StateCard>
      ) : null}
      {error ? <ErrorCard error={error} onRetry={load} /> : null}

      <div className="note">
        <strong>Public:</strong>
        <span>
          this amount and time on Solana, when it enters the shielded pool, and — on the bridge’s explorer — that your Solana wallet paid this Zcash
          address. Our fee goes to one NEAR account, so the explorer can also group this move with other ZecDoor moves.
        </span>
        <strong style={{ marginTop: 4 }}>Private:</strong>
        <span>everything you do with it after it lands.</span>
      </div>

      <button type="button" className="btn" disabled={!dry || expired || busy || noSol} onClick={() => void sign()}>
        {stage ? STAGE_TEXT[stage] : 'Sign in Phantom'}
      </button>
      <p className="muted center" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        One transaction. No message signature. By signing you accept the <a href={TERMS_URL}>Terms</a>.
      </p>
    </Shell>
  );
}

function ErrorCard({ error, onRetry }: { error: MoveError; onRetry: () => void }) {
  const map: Partial<Record<MoveError['code'], { title: string; tone: 'err' | 'warn' | 'info'; action?: string }>> = {
    paused: { title: 'The bridge is paused', tone: 'err' },
    region: { title: 'Not available in your region', tone: 'err' },
    topup_region: { title: 'Top-up not available in your region', tone: 'err' },
    sanctioned: { title: 'This wallet can’t use ZecDoor', tone: 'err' },
    too_small: { title: 'Below the bridge minimum', tone: 'warn' },
    price_moved: { title: 'The price moved', tone: 'info', action: 'See the new quote' },
    no_sol: { title: 'Not enough SOL for fees', tone: 'warn', action: 'Check again' },
    no_route: { title: 'No route right now', tone: 'warn', action: 'Try again' },
    cancelled: { title: 'Cancelled', tone: 'info' },
    rpc: { title: 'Solana is not answering', tone: 'warn', action: 'Try again' },
    quote: { title: 'No quote', tone: 'warn', action: 'Try again' },
    simulation: { title: 'Not offered for signing', tone: 'err', action: 'Try again' },
  };
  const m = map[error.code] ?? { title: 'Something went wrong', tone: 'err' as const };
  return (
    <StateCard tone={m.tone} title={m.title} tag="Before signing" {...(m.action ? { action: m.action, onAction: onRetry } : {})}>
      {error.message}
    </StateCard>
  );
}
