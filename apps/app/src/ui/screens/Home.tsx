import { useState } from 'react';
import { ZEC_MINT } from '@zecdoor/solana';
import { APP_URL, MOVES_OPEN } from '../../config';
import { day, short, usd, zec } from '../../lib/format';
import { phantomBrowseLink } from '../../lib/phantom';
import { continueWith, landsIn } from '../flow';
import { AsideBox, AsideHead, Chevron, Logo, Qr, Shell, StateCard } from '../parts';
import { go } from '../router';
import { useApp } from '../state';
import { statusLabel } from './Move';
import { feeOk } from '../../lib/server';

export function Home() {
  const app = useApp();
  const { owner, balances, balanceError, minimum, wallet, draft, health, geo, prices, moves } = app;
  const [menu, setMenu] = useState(false);
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

  return (
    <Shell
      aside={
        <>
          <AsideHead>On a computer?</AsideHead>
          <p>Use the Phantom browser extension. Everything works the same, and the view-only check runs in this tab.</p>
          <AsideBox title="The route">
            <span>Phantom → NEAR Intents deposit address → NEAR Intents pays your Zcash address → shielded pool (Ironwood).</span>
          </AsideBox>
          <AsideBox title="Rather use your phone?">
            <span>Scan to open this page inside Phantom mobile.</span>
            <Qr text={phantomBrowseLink(APP_URL)} label="QR code that opens ZecDoor in Phantom" />
          </AsideBox>
        </>
      }
    >
      <div className="bar">
        <div className="brand">
          <Logo />
          ZecDoor
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="pill" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span className="dot" />
            {owner ? short(owner.toBase58(), 4, 3) : ''}
          </button>
          {menu ? (
            <div className="card" style={{ position: 'absolute', right: 0, top: 46, zIndex: 2, padding: 8, minWidth: 180 }}>
              <button type="button" className="btn ghost sm" onClick={() => void app.disconnect()}>
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      </div>

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

      <div className="history">
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
