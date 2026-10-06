import { useEffect, useState } from 'react';
import { APP_FEE_BPS, ZEC_MINT } from '@zecdoor/solana';
import { MOVES_OPEN } from '../../config';
import { day, short, sol, usd, zec } from '../../lib/format';
import { dryQuote, type DryQuote } from '../../lib/move';
import { solNeeded } from '../../lib/solana';
import { continueWith, landsIn } from '../flow';
import { Chevron, Logo, Panel, Shell, StateCard } from '../parts';
import { networkFee, NetworkFeeLabel, PanelRows, PublicPanel, RecentPanel, RoutePanel, useWide } from '../rail';
import { go } from '../router';
import { CounterPanel, FaqPanel, FeesPanel, FirstRun, MoveSteps } from '../extras';
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

  return (
    <Shell
      left={
        <>
          <MoveSteps />
          <FirstRun />
        </>
      }
      rail={
        <>
          <RoutePanel kind={small ? 'topup' : 'exit'} owner={ownerStr} dest={landsIn(draft, wallet).replace(' · fresh address', '')} />
          <Panel title="Live quote" cap={lq ? <span className="chip okc">Signed by NEAR Intents · checked</span> : undefined}>
            {lq && bal ? (
              <>
                <PanelRows
                  rows={[
                    ['You send', zec(bal)],
                    ['Arrives shielded, at least', zec(BigInt(lq.minAmountOut), 0)],
                    [<NetworkFeeLabel key="f" />, networkFee(lq.withdrawFee)],
                    [`Our fee (${APP_FEE_BPS.exit / 100}%)`, zec((bal * BigInt(APP_FEE_BPS.exit)) / 10_000n, 0)],
                    ['Solana fees and deposits', `≈ ${sol(solNeeded('exit'))}`],
                    ['Usually arrives', '3–9 min'],
                  ]}
                />
                <p className="sub">Refreshes every 30 s. Nothing is signed until you review and sign.</p>
              </>
            ) : (
              <p className="sub">
                {loading
                  ? 'Reading your balance…'
                  : empty
                    ? 'You have no ZEC on Solana. Buy shielded ZEC with USDC or SOL instead.'
                    : small
                      ? `Your balance is below the bridge minimum of ${zec(minimum!)}. The top-up screen prices the swap that brings it over.`
                      : blocked || paused
                        ? 'No quote while moves are unavailable here.'
                        : 'Getting a signed quote from NEAR Intents…'}
              </p>
            )}
          </Panel>
          <PublicPanel owner={ownerStr} />
          <RecentPanel moves={moves} owner={ownerStr} />
          <CounterPanel />
          <FeesPanel minimum={minimum} />
          <FaqPanel />
        </>
      }
    >
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

      {small ? (
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
              : 'All of it, to a Zcash address only you control. Usually arrives in 3–9 minutes.'}
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
