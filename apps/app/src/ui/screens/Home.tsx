import { useEffect, useState } from 'react';
import { APP_FEE_BPS } from '@zecdoor/solana';
import { MOVES_OPEN } from '../../config';
import { estimate, short, units, usd, zec } from '../../lib/format';
import { dryQuote, type DryQuote } from '../../lib/move';
import { movingCost, QUOTED_PAYOUT_FEE_ZAT } from '../../lib/economics';
import { DeskTabs, Empty, Field, Line, Pair, Strip, Tok, WalletGlyph } from '../desk';
import { continueWith, landsIn } from '../flow';
import { Shell, StateCard } from '../parts';
import { go } from '../router';
import { useApp } from '../state';
import { feeOk } from '../../lib/server';

const QUOTE_REFRESH_MS = 30_000;

export function Home() {
  const app = useApp();
  const { owner, balances, balanceError, minimum, wallet, draft, health, geo, prices, notice } = app;
  const [busy, setBusy] = useState(false);

  const blocked = geo?.allowed === false;
  const paused = !!health?.paused || !feeOk(health, 'exit');
  const bal = balances?.zec ?? null;
  const loading = bal === null || minimum === null;
  const small = !loading && bal! > 0n && bal! < minimum!;
  const empty = !loading && bal === 0n;
  const topupAllowed = geo?.topup !== false;
  const need = small ? minimum! - bal! : 0n;
  const needUsd = prices.zec ? (Number(need) / 1e8) * prices.zec : null;
  // Worth less than a move costs: say so plainly; the top-up stays available but is not recommended.
  const cost = minimum ? movingCost(minimum, prices) : null;
  const dust = small && topupAllowed && !!cost && bal! < cost.zat;
  const asUsd = (zat: bigint) => (prices.zec ? usd(Math.max((Number(zat) / 1e8) * prices.zec, 0.01)) : zec(zat, 0));

  const start = async () => {
    if (!bal || blocked || paused) return;
    if (small) return go('/topup');
    setBusy(true);
    try {
      await continueWith({ kind: 'exit', amount: bal, ...(draft?.dest ? { dest: draft.dest } : {}) }, wallet, app.setDraft);
    } finally {
      setBusy(false);
    }
  };

  const ownerStr = owner?.toBase58() ?? null;

  // The live quote in the rail (from 768 px only: the phone layout never shows it).
  const [live, setLive] = useState<DryQuote | null>(null);
  const quotable = !!owner && !!bal && !loading && !small && !blocked;
  useEffect(() => {
    setLive(null);
    if (!quotable || !owner || !bal) return;
    let on = true;
    const run = () => dryQuote('exit', bal, owner).then((q) => on && setLive(q)).catch(() => on && setLive(null));
    void run();
    const t = setInterval(run, QUOTE_REFRESH_MS);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [quotable, owner, bal]);
  const lq = live?.resp.quote;

  const ready = !loading && !blocked && !paused && !busy && !(small && !topupAllowed);
  const label = loading ? 'Reading your balance…' : !MOVES_OPEN ? 'Opening soon' : small ? 'Top up and shield' : 'Review move';
  return (
    <Shell nav="move">
      <DeskTabs at="move" />
      {!MOVES_OPEN ? (
        <Strip>
          <strong>Opening soon.</strong> Moves and buys open once our own Phantom test moves pass. Your balance and live quotes work now.
        </Strip>
      ) : null}
      {notice ? (
        <StateCard tone="warn" title="Your wallet switched accounts" action="OK" onAction={app.clearNotice}>
          What you had started was for {short(notice.from, 4, 3)} and was stopped before signing. Now connected as {short(notice.to, 4, 3)}. Nothing was sent.
        </StateCard>
      ) : null}
      {paused ? (
        <StateCard tone="err" title="The bridge is paused" tag="Before signing">
          {health?.message ?? (health?.paused ? 'NEAR Intents has paused transfers.' : 'Moves are paused while we check NEAR Intents’ fee terms.')} Nothing was sent.
        </StateCard>
      ) : null}
      {blocked ? (
        <StateCard tone="err" title="Not available in your region" tag="Before signing">
          This service is not offered where you are, under our bridge partner’s terms.
        </StateCard>
      ) : null}
      {balanceError ? (
        <StateCard tone="warn" title="Can’t read your balance" action="Try again" onAction={() => void app.refreshBalances()}>
          {balanceError}
        </StateCard>
      ) : null}

      {empty ? (
        <Empty
          icon={<WalletGlyph />}
          title="No ZEC on Solana in this wallet"
          actions={
            <>
              <button type="button" className="btn" onClick={() => go('/buy')}>
                Buy shielded ZEC
              </button>
              <button type="button" className="btn ghost" onClick={() => go('/check')}>
                Check another address
              </button>
            </>
          }
        >
          {short(ownerStr ?? '', 4, 4)} holds no bridged ZEC. You can buy shielded ZEC with the USDC or SOL it holds.
        </Empty>
      ) : (
        <>
          <Pair>
            <Field
              label="You move"
              right={bal === null ? 'Reading…' : `Balance ${zec(bal)}`}
              amount={bal === null ? '—' : units(bal, 8, 2)}
              muted={bal === null}
              token={<Tok kind="solana" />}
              foot={
                <>
                  <span>{bal !== null && prices.zec ? `≈ ${asUsd(bal)}` : ' '}</span>
                  <span>All of it, in one signature</span>
                </>
              }
            />
            <Field
              label="You receive at least"
              right="shielded"
              amount={lq ? units(BigInt(lq.minAmountOut), 8, 2) : '—'}
              muted={!lq}
              token={<Tok kind="zcash" />}
              foot={
                <>
                  <span>
                    Lands in <strong>{landsIn(draft, wallet).replace(' · fresh address', '')}</strong>
                  </span>
                  <a href="#/destination">Change</a>
                </>
              }
            />
          </Pair>
          {dust ? (
            <Strip tone="warn">
              <strong>Worth less than moving it costs.</strong> Your {zec(bal!, 0)} is worth about {asUsd(bal!)}; one move costs about {asUsd(cost!.zat)}{' '}
              in fixed fees. You can still top up, but we don’t recommend it.
            </Strip>
          ) : small ? (
            <Strip tone="warn">
              <strong>Below the bridge minimum of {zec(minimum!)}.</strong>{' '}
              {topupAllowed
                ? `Add about ${needUsd !== null ? usd(Math.max(needUsd, 0.01)) : 'a little'} of SOL or USDC in the same signature and move all of it.`
                : 'Top-up is not offered where you are.'}
            </Strip>
          ) : null}
          <Line
            left={`Fee ${APP_FEE_BPS.exit / 100}% · bridge up to ${zec(lq?.withdrawFee ? BigInt(lq.withdrawFee) : QUOTED_PAYOUT_FEE_ZAT, 0)}`}
            right={lq && estimate(lq.timeEstimate) ? `NEAR Intents est. ${estimate(lq.timeEstimate)}` : small ? 'Priced on the next screen' : 'Getting a quote…'}
          />
          <button type="button" className="btn" onClick={() => void start()} disabled={!ready || !MOVES_OPEN}>
            {label}
          </button>
        </>
      )}
    </Shell>
  );
}
