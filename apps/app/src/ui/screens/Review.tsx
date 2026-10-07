import { FEE_RECIPIENT } from '@zecdoor/solana';
import { useCallback, useEffect, useState } from 'react';
import { MOVES_OPEN, QUOTE_FRESH_MS, TERMS_URL } from '../../config';
import { clock, estimate, short, sol, usdc, zec } from '../../lib/format';
import { dryQuote, executeMove, MoveError, type DryQuote, type Stage } from '../../lib/move';
import { solNeeded } from '../../lib/solana';
import { BackBar, CheckCircle, Shell, Spinner, StateCard } from '../parts';
import { networkFee, NetworkFeeLabel } from '../rail';
import { go } from '../router';
import { useApp } from '../state';
import { useWide } from '../rail';
import { PublicStrip } from '../desk';

const stageText = (s: Stage, wallet: string): string =>
  ({
    checking: 'Checking the bridge…',
    quoting: 'Getting your signed quote…',
    building: 'Building and checking the transaction…',
    signing: `Confirm in ${wallet}…`,
    sending: 'Sending…',
  })[s];

const ORDER: Stage[] = ['checking', 'quoting', 'building', 'signing', 'sending'];

export function Review() {
  const app = useApp();
  const { draft, owner, balances } = app;
  const walletName = app.wallet$.connected?.name ?? 'your wallet';
  const [dry, setDry] = useState<DryQuote | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<MoveError | null>(null);
  const wide = useWide();

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

  if (!draft?.dest || !owner) return null;
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
        signAndSend: app.signAndSend,
        walletName,
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

  const rows: Array<[React.ReactNode, React.ReactNode]> = [
    ['To', `${short(dest.address, 4, 4)} · ${dest.kind === 'browser' ? 'new address in this browser' : 'your wallet'}`],
    [<NetworkFeeLabel key="f" />, networkFee(q?.withdrawFee)],
    [`Our fee (${ourBps / 100}%)`, feeOf(ourBps)],
    ...(theirBps ? ([[`NEAR Intents fee (${theirBps / 100}%)`, feeOf(theirBps)]] as Array<[string, string]>) : []),
    ['Solana fees and deposits', `≈ ${sol(solCost)}`],
    ['NEAR Intents estimates', estimate(q?.timeEstimate) ?? '—'],
    ['If it can’t complete', `refund to ${short(owner.toBase58(), 4, 3)} at the quote’s deadline`],
  ];
  const at = stage ? ORDER.indexOf(stage) : -1;

  if (wide) {
    const receive = q ? zec(BigInt(q.minAmountOut), 0) : '—';
    const deskRows: Array<[string, React.ReactNode, boolean?]> = [
      ['You send', sendLabel],
      ...(draft.topUp
        ? ([['of which swapped into ZEC', `up to ${draft.topUp.payWith === 'sol' ? sol(draft.topUp.maxPay) : usdc(draft.topUp.maxPay)}`]] as Array<[string, string]>)
        : []),
      ['You receive at least', receive, true],
      [
        `Fees (${(ourBps + theirBps) / 100}% + bridge)`,
        dry ? (
          <>
            {feeOf(ourBps + theirBps)} + {networkFee(q?.withdrawFee)}
          </>
        ) : (
          '—'
        ),
      ],
      ['Solana fees and deposit', `≈ ${sol(solCost)}`],
      ['Lands in', rows[0]![1]],
      ['NEAR Intents estimates', estimate(q?.timeEstimate) ?? '—'],
    ];
    return (
      <Shell nav={draft.kind === 'buyUsdc' || draft.kind === 'buySol' ? 'buy' : 'move'}>
        <div className="dhead">
          <button type="button" className="dback" aria-label="Back" onClick={() => history.back()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <h1>Review your {draft.kind === 'buyUsdc' || draft.kind === 'buySol' ? 'buy' : 'move'}</h1>
          {dry && !expired ? <span className="caption">Quote valid {clock(left)}</span> : null}
        </div>
        {!dry && !error ? <Spinner label="Getting a signed quote from NEAR Intents…" /> : null}
        <dl className="drows">
          {deskRows.map(([k, v, strong]) => (
            <div key={k} className={strong ? 'strong' : undefined}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <PublicStrip />
        <div className="dchecks" aria-label="Checks before your wallet sees it">
          <span className={dry ? undefined : 'wait'}>{dry ? '✓' : '·'} Quote signed by NEAR Intents</span>
          <span className="wait">allowlist and simulation when you sign</span>
        </div>
        {expired ? (
          <StateCard tone="info" title="Quote expired" tag="Before signing" action="Get a new quote" onAction={load}>
            Prices moved while this screen was open. Nothing was sent.
          </StateCard>
        ) : null}
        {noSol && !error ? (
          <StateCard tone="warn" title="Not enough SOL for fees" tag="Before signing" action="Check again" onAction={() => void app.refreshBalances()}>
            You need about {sol(needSol)} for this move. Add SOL in Phantom, then come back.
          </StateCard>
        ) : null}
        {error ? <ErrorCard error={error} onRetry={load} /> : null}
        {MOVES_OPEN ? (
          <>
            {stage ? (
              <ol className="tl" aria-label="Before your wallet sees it">
                {ORDER.slice(0, 4).map((s2, i) => (
                  <li key={s2}>
                    <span className={`n ${i < at ? 'ok' : i === at ? 'now' : ''}`}>{i < at ? '✓' : i + 1}</span>
                    <span>
                      <span className="h">{stageText(s2, walletName).replace('…', '')}</span>
                      {s2 === 'signing' && at === i ? <span className="d">{walletName} shows one transaction. Approve it there. Nothing has been sent yet.</span> : null}
                    </span>
                    <span className="r">{i < at ? 'done' : ''}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <button type="button" className="btn" disabled={!dry || expired || busy || noSol} onClick={() => void sign()}>
              {stage ? stageText(stage, walletName) : `Sign in ${walletName === 'your wallet' ? 'your wallet' : walletName}`}
            </button>
            <p className="muted center" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              One transaction, no message signature. Refunded at the quote’s deadline if it can’t complete. By signing you accept the{' '}
              <a href={TERMS_URL}>Terms</a>.
            </p>
          </>
        ) : (
          <button type="button" className="btn" disabled>
            Opening soon
          </button>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <BackBar title="Review" back={() => history.back()} step={dry && !expired ? `Quote valid ${clock(left)}` : undefined} />

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
        <div className="dk" style={{ borderTop: '1px solid var(--line)', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
          <span className="muted">To</span>
          <span className="mono" style={{ textAlign: 'right' }}>{rows[0]![1]}</span>
        </div>
      </div>

      {!dry && !error ? <Spinner label="Getting a signed quote from NEAR Intents…" /> : null}

      {dry ? (
        <dl className="rows ph">
          {rows.map(([k, v], i) => (
            <div key={i}>
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
      {dry ? (
        <p className="dk ok" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <CheckCircle />
          Quote signed by NEAR Intents and checked by this page
        </p>
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

      <div className="note ph">
        <strong>Public:</strong>
        <span>
          this amount and time on Solana, when it enters the shielded pool, and — on the bridge’s explorer — that your Solana wallet paid this Zcash
          address. Our fee goes to one NEAR account, so the explorer can also group this move with other ZecDoor moves.
        </span>
        <strong style={{ marginTop: 4 }}>Private:</strong>
        <span>everything you do with it after it lands.</span>
      </div>

      {MOVES_OPEN ? (
        <>
          {stage ? (
            <ol className="tl dk" aria-label="Before your wallet sees it">
              {ORDER.slice(0, 4).map((s2, i) => (
                <li key={s2}>
                  <span className={`n ${i < at ? 'ok' : i === at ? 'now' : ''}`}>{i < at ? '✓' : i + 1}</span>
                  <span>
                    <span className="h">{stageText(s2, walletName).replace('…', '')}</span>
                    {s2 === 'signing' && at === i ? <span className="d">{walletName} shows one transaction. Approve it there. Nothing has been sent yet.</span> : null}
                  </span>
                  <span className="r">{i < at ? 'done' : ''}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <button type="button" className="btn" disabled={!dry || expired || busy || noSol} onClick={() => void sign()}>
            {stage ? stageText(stage, walletName) : `Sign in ${walletName === 'your wallet' ? 'your wallet' : walletName}`}
          </button>
          <p className="muted center" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            One transaction. No message signature. By signing you accept the <a href={TERMS_URL}>Terms</a>.
          </p>
        </>
      ) : (
        <>
          <StateCard tone="info" title="Opening soon" tag="Nothing to sign yet">
            Moves and buys open once our own mainnet test moves have passed. This quote is live and shows exactly what a move would cost
            today; nothing can be signed yet.
          </StateCard>
          <button type="button" className="btn" disabled>
            Opening soon
          </button>
        </>
      )}
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
    cancelled: { title: 'Cancelled', tone: 'info', action: 'Review again' },
    wallet_busy: { title: 'Your wallet is waiting for you', tone: 'warn', action: 'Try again' },
    account_changed: { title: 'Your wallet switched accounts', tone: 'warn' },
    wallet_failed: { title: 'Your wallet couldn’t send it', tone: 'err', action: 'Try again' },
    rpc: { title: 'Solana is not answering', tone: 'warn', action: 'Try again' },
    quote: { title: 'No quote', tone: 'warn', action: 'Try again' },
    simulation: { title: 'Not offered for signing', tone: 'err', action: 'Try again' },
    closed: { title: 'Opening soon', tone: 'info' },
  };
  const m = map[error.code] ?? { title: 'Something went wrong', tone: 'err' as const };
  return (
    <StateCard tone={m.tone} title={m.title} tag="Before signing" {...(m.action ? { action: m.action, onAction: onRetry } : {})}>
      {error.message}
    </StateCard>
  );
}
