import { useEffect, useState } from 'react';
import { APP_FEE_BPS, ZEC_MINT } from '@zecdoor/solana';
import { MOVES_OPEN } from '../../config';
import { day, estimate, short, units, usd, zec } from '../../lib/format';
import { dryQuote, type DryQuote } from '../../lib/move';
import { movingCost, QUOTED_PAYOUT_FEE_ZAT } from '../../lib/economics';
import { DeskTabs, Empty, Field, Line, Pair, Strip, Tok, WalletGlyph } from '../desk';
import { continueWith, landsIn } from '../flow';
import { Chevron, Logo, Shell, StateCard } from '../parts';
import { useWide } from '../rail';
import { go } from '../router';
import { useApp } from '../state';
import { Menu, useWalletMenuItems } from '../wallet-ui';
import { statusLabel } from './Move';
import { feeOk } from '../../lib/server';

const QUOTE_REFRESH_MS = 30_000;

export function Home() {
  const app = useApp();
  const { owner, balances, balanceError, minimum, wallet, draft, health, geo, prices, moves, notice } = app;
  const [busy, setBusy] = useState(false);
  const menuItems = useWalletMenuItems();
  const wide = useWide();

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

  const mine = moves.filter((m) => m.owner === owner?.toBase58()).slice(0, 5);
  const ownerStr = owner?.toBase58() ?? null;

  // The live quote in the rail (from 768 px only: the phone layout never shows it).
  const [live, setLive] = useState<DryQuote | null>(null);
  const quotable = wide && !!owner && !!bal && !loading && !small && !blocked;
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

  if (wide) {
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

  return (
    <Shell>
      <div className="bar ph">
        <div className="brand">
          <Logo />
          ZecDoor
        </div>
        <Menu
          label="Wallet"
          items={menuItems}
          button={(p) => (
            <button type="button" className="pill" aria-label={`Wallet ${owner ? short(owner.toBase58(), 4, 3) : ''}, open wallet menu`} {...p}>
              <span className="dot" />
              {owner ? short(owner.toBase58(), 4, 3) : ''}
            </button>
          )}
        />
      </div>

      {notice ? (
        <StateCard tone="warn" title="Your wallet switched accounts" action="OK" onAction={app.clearNotice}>
          What you had started was for {short(notice.from, 4, 3)} and was stopped before signing. Now connected as {short(notice.to, 4, 3)}; balances and
          quotes are for this account. Nothing was sent.
        </StateCard>
      ) : null}

      {!MOVES_OPEN ? (
        <StateCard tone="info" title="Opening soon" tag="Moves and buys">
          You can connect, see your balance and live quotes, and make and back up a wallet now. Signing opens once our own mainnet test
          moves have passed.
        </StateCard>
      ) : null}
      {paused ? (
        <StateCard tone="err" title="The bridge is paused" tag="Before signing">
          {health?.message ?? (health?.paused ? 'NEAR Intents has paused transfers.' : 'Moves are paused while we check NEAR Intents’ fee terms.')} Nothing was sent, and we won’t send anything until it resumes. This page
          updates on its own.
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

      <div className="card">
        <span className="label">ZEC on Solana</span>
        <span className="amount" aria-live="polite">
          {bal === null ? '—' : zec(bal)}
        </span>
        <span className="caption">Bridged ZEC · NEAR Omni · {short(ZEC_MINT.toBase58(), 4, 4)}</span>
      </div>

      {dust ? (
        <StateCard tone="warn" title="Worth less than moving it costs">
          Your {zec(bal!, 0)} is worth about {asUsd(bal!)}. One move costs about {asUsd(cost!.zat)} in fixed fees: the bridge’s payout fee (up to{' '}
          {zec(cost!.payoutFee, 0)}), the deposit account and Solana fee (about {asUsd(cost!.solana)}), our 0.25% and the swap’s 1% limit. You would
          pay more than you move. You can still top up, but we don’t recommend it.
        </StateCard>
      ) : small ? (
        <div className="note warn" style={{ fontSize: 14, borderRadius: 16, padding: '14px 16px' }}>
          <strong>Below the bridge minimum of {zec(minimum!)}</strong>
          <span>
            {topupAllowed
              ? `Add about ${needUsd !== null ? usd(Math.max(needUsd, 0.01)) : 'a little'} of SOL or USDC in the same signature and move all of it.`
              : 'Top-up is not offered where you are. Payouts that bring you over the minimum can be moved then.'}
          </span>
        </div>
      ) : null}

      {empty ? (
        <button type="button" className="primary-card" onClick={() => go('/buy')} disabled={blocked || paused} style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
          <span className="title">Buy shielded ZEC</span>
          <span className="body">You have no ZEC on Solana. Pay with USDC or SOL from this wallet; it lands in a shielded address only you control.</span>
          <span className="btn inner">Buy shielded ZEC</span>
        </button>
      ) : (
        <button
          type="button"
          className="primary-card"
          onClick={() => void start()}
          disabled={loading || blocked || paused || busy || (small && !topupAllowed)}
          aria-disabled={loading || blocked || paused || (small && !topupAllowed)}
          style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', opacity: loading || blocked || paused || (small && !topupAllowed) ? 0.6 : 1 }}
        >
          <span className="title">{small ? 'Top up and shield' : 'Move it to shielded'}</span>
          <span className="body">
            {small
              ? 'Swap a little SOL or USDC into ZEC and move everything, in one signature.'
              : 'All of it, to a Zcash address only you control.'}
          </span>
          <span className="btn inner">{loading ? 'Reading your balance…' : small ? 'Top up and shield' : `Move ${zec(bal!)}`}</span>
        </button>
      )}

      {empty ? null : (
        <button type="button" className="row-link" onClick={() => go('/buy')}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Buy shielded ZEC</span>
            <span className="muted" style={{ fontSize: 14 }}>
              Pay with USDC or SOL
            </span>
          </span>
          <Chevron />
        </button>
      )}

      <div className="note" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderRadius: 16, padding: '14px 16px' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13 }}>Lands in</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{landsIn(draft, wallet)}</span>
        </span>
        <button type="button" className="chip" onClick={() => go('/destination')}>
          Change
        </button>
      </div>

      <div className="history ph">
        <span className="muted" style={{ fontSize: 13 }}>
          Recent moves · kept in this browser only
        </span>
        {mine.length === 0 ? (
          <span className="item muted">None yet</span>
        ) : (
          mine.map((m) => {
            const s = statusLabel(m);
            return (
              <a key={m.depositAddress} href={`#/move/${m.depositAddress}`}>
                <span>{m.kind === 'buyUsdc' || m.kind === 'buySol' ? `Bought ${zec(BigInt(m.amountOut))}` : `${zec(BigInt(m.amountIn))} → shielded`}</span>
                <span style={{ color: s.color }}>
                  {s.text} · {day(m.createdAt)}
                </span>
              </a>
            );
          })
        )}
      </div>
    </Shell>
  );
}
