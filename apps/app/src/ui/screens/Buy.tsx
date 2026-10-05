import { FEE_RECIPIENT, type MoveKind } from '@zecdoor/solana';
import { useEffect, useState } from 'react';
import { clock, parseUnits, sol, units, usd, usdc, zec } from '../../lib/format';
import { dryQuote, MoveError, type DryQuote } from '../../lib/move';
import { solNeeded } from '../../lib/solana';
import { AsideHead, BackBar, Rows, Shell, StateCard } from '../parts';
import { go } from '../router';
import { useApp } from '../state';

const REFRESH_MS = 30_000;

export function Buy() {
  const app = useApp();
  const { owner, balances, geo, health } = app;
  const [symbol, setSymbol] = useState<'USDC' | 'SOL'>(app.draft?.pay?.symbol ?? 'USDC');
  const [text, setText] = useState(app.draft?.pay ? units(app.draft.pay.amount, app.draft.pay.symbol === 'SOL' ? 9 : 6) : '25');
  const [quote, setQuote] = useState<DryQuote | null>(null);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  const kind: MoveKind = symbol === 'SOL' ? 'buySol' : 'buyUsdc';
  const decimals = symbol === 'SOL' ? 9 : 6;
  const amount = parseUnits(text, decimals);
  const balance = symbol === 'SOL' ? balances?.sol : balances?.usdc;
  const reserve = solNeeded(kind);
  const spendable = balance === undefined ? undefined : symbol === 'SOL' ? (balance > reserve ? balance - reserve : 0n) : balance;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setQuote(null);
    setProblem(null);
    if (!owner || !amount || amount <= 0n) return;
    let live = true;
    const run = () =>
      dryQuote(kind, amount, owner)
        .then((q) => live && (setQuote(q), setProblem(null)))
        .catch((e: unknown) => {
          if (!live) return;
          if (e instanceof MoveError && e.code === 'too_small' && e.detail?.minimum) {
            setProblem({ title: 'Below the minimum order', body: `The smallest order now is ${symbol === 'SOL' ? sol(e.detail.minimum) : usdc(e.detail.minimum)}.` });
          } else setProblem({ title: 'No price right now', body: (e as Error).message });
        });
    const debounce = setTimeout(run, 450);
    const refresh = setInterval(run, REFRESH_MS);
    return () => {
      live = false;
      clearTimeout(debounce);
      clearInterval(refresh);
    };
  }, [owner, kind, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = quote?.resp.quote;
  const rows = quote?.resp.quoteRequest.appFees ?? [];
  const ours = rows.filter((f) => f.recipient === FEE_RECIPIENT).reduce((s, f) => s + f.fee, 0);
  const theirs = rows.filter((f) => f.recipient !== FEE_RECIPIENT).reduce((s, f) => s + f.fee, 0);
  const tooMuch = amount !== null && spendable !== undefined && amount > spendable;
  const out = q ? BigInt(q.amountOut) : null;
  const rate = q && out ? Number(q.amountInFormatted) / (Number(out) / 1e8) : null;
  const usdIn = q ? Number(q.amountInUsd) : null;
  const fixedShare = q?.withdrawFee && out ? (Number(q.withdrawFee) / (Number(out) + Number(q.withdrawFee))) * 100 : null;
  const blocked = geo?.allowed === false || !!health?.paused;

  const next = () => {
    if (!amount || !q || tooMuch || blocked) return;
    app.setDraft({ kind, amount, pay: { symbol, amount }, ...(app.draft?.dest ? { dest: app.draft.dest } : {}) });
    go('/destination');
  };

  return (
    <Shell
      nav="buy"
      aside={
        <>
          <AsideHead>Where your money goes</AsideHead>
          <p>
            Your {symbol} goes from Phantom to a NEAR Intents deposit address. NEAR Intents swaps it and pays native ZEC to your shielded address. If the
            price moves more than 1% before it completes, it refunds your Solana wallet instead.
          </p>
        </>
      }
    >
      <BackBar title="Buy shielded ZEC" back="/" />

      <div className="card tight">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <label htmlFor="pay" className="label">
            You pay
          </label>
          <span className="label">Balance {balance === undefined ? '—' : symbol === 'SOL' ? sol(balance) : usdc(balance)}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            id="pay"
            className="amount-input"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={amount === null || tooMuch}
            autoComplete="off"
          />
          <div className="toggle" style={{ flex: 'none', width: 168 }}>
            <button type="button" aria-pressed={symbol === 'USDC'} onClick={() => setSymbol('USDC')}>
              USDC
            </button>
            <button type="button" aria-pressed={symbol === 'SOL'} onClick={() => setSymbol('SOL')}>
              SOL
            </button>
          </div>
        </div>
        <div className="rule" style={{ margin: '6px 0' }} />
        <span className="label">You receive at least</span>
        <span className="amount md">{q ? zec(BigInt(q.minAmountOut)) : '—'}</span>
        <span className="label">
          Shielded, in Ironwood{quote ? ` · price refreshes in ${clock(REFRESH_MS - ((now - quote.at) % REFRESH_MS))}` : ''}
        </span>
      </div>

      {tooMuch ? (
        <StateCard tone="warn" title={`More than you can spend`}>
          {symbol === 'SOL'
            ? `Keep about ${sol(reserve)} for Solana fees. You can spend up to ${sol(spendable!)}.`
            : `You have ${usdc(balance!)}.`}
        </StateCard>
      ) : null}
      {problem ? (
        <StateCard tone="warn" title={problem.title}>
          {problem.body}
        </StateCard>
      ) : null}

      <Rows
        rows={[
          ['Rate', rate ? `1 ZEC ≈ ${rate.toFixed(symbol === 'SOL' ? 4 : 2)} ${symbol}` : '—'],
          ['Bridge network fee', q?.withdrawFee ? zec(BigInt(q.withdrawFee), 0) : '—'],
          ['NEAR Intents fee', q ? `${theirs / 100}%` : '—'],
          ['Our fee', q ? `${ours / 100}%` : '—'],
          ['Value in', usdIn !== null ? usd(usdIn) : '—'],
        ]}
      />

      {fixedShare !== null && usdIn !== null && usdIn < 10 ? (
        <div className="note warn">
          <strong>Small order</strong>
          <span>The fixed bridge fee is {fixedShare.toFixed(1)}% of this order. Larger orders lose less to it.</span>
        </div>
      ) : (
        <div className="note">Under $10, the fixed bridge fee is a large share of the order. We show the share before you sign.</div>
      )}

      <button type="button" className="btn" disabled={!q || tooMuch || blocked} onClick={next}>
        Choose where it lands
      </button>
    </Shell>
  );
}
