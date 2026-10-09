import { useState } from 'react';
import { APP_URL, DOMAIN, MOVES_OPEN } from '../../config';
import { isMobile, phantomBrowseLink } from '../../lib/phantom';
import { Qr, Shell, StateCard } from '../parts';
import { useApp } from '../state';
import { DeskTabs, Field, Line, Pair, Strip, Tok } from '../desk';
import { openPicker } from '../wallet-ui';

export function Connect() {
  const { wallet$, connect } = useApp();
  const [error, setError] = useState<string | null>(null);
  const link = phantomBrowseLink(APP_URL);
  const supported = wallet$.options.filter((o) => o.supported);
  // One supported wallet and nothing else: connect straight away. Several: let the user pick.
  const direct = supported.length === 1 && wallet$.options.length === 1 ? supported[0]! : null;

  const onConnect = async () => {
    setError(null);
    if (!direct) return openPicker();
    try {
      await connect(direct.name);
    } catch (e) {
      setError((e as Error).message || `${direct.name} did not connect. Open it and try again.`);
    }
  };

  const connectButton = supported.length ? (
    <button type="button" className="btn" onClick={() => void onConnect()} disabled={wallet$.connecting}>
      {wallet$.connecting ? `Waiting for ${direct?.name ?? 'your wallet'}…` : direct ? `Connect ${direct.name}` : 'Connect wallet'}
    </button>
  ) : isMobile() ? (
    // A phone browser without Phantom: open this page inside Phantom instead.
    <a className="btn" href={link}>
      Open in Phantom
    </a>
  ) : (
    <a className="btn" href="https://phantom.com/download" target="_blank" rel="noreferrer">
      Get Phantom
    </a>
  );
  return (
    <Shell
      nav="move"
      hero={
        <>
          <h1>Bring your ZEC home.</h1>
          <p>The ZEC you hold on Solana, into a shielded Zcash wallet you control. One signature in Phantom.</p>
        </>
      }
    >
      <DeskTabs at="move" heading={false} />
      {!MOVES_OPEN ? (
        <Strip>
          <strong>Opening soon.</strong> Moves and buys open once our own Phantom test moves pass. Connect now to see your balance and a live quote.
        </Strip>
      ) : null}
      {error ? (
        <StateCard tone="err" title="Not connected">
          {error}
        </StateCard>
      ) : null}
      <Pair>
        <Field
          label="You move"
          right="Connect to read your balance"
          amount="—"
          muted
          token={<Tok kind="solana" />}
          foot={
            <>
              <span> </span>
              <span>All of it, in one signature</span>
            </>
          }
        />
        <Field
          label="You receive at least"
          right="shielded"
          amount="—"
          muted
          token={<Tok kind="zcash" />}
          foot={<span>Lands in a Zcash address only you control</span>}
        />
      </Pair>
      <Line left="Fee 0.25% · bridge up to 0.00032 ZEC" right="Refunded if it can’t complete" />
      {connectButton}
      <div className="dlinks">
        <details>
          <summary>On a phone? Open in Phantom</summary>
          <Qr text={link} label="QR code that opens ZecDoor in Phantom" />
          <a href={link} style={{ display: 'block', marginTop: 8, color: 'var(--accent-text)', fontWeight: 600 }}>
            Open this page in Phantom
          </a>
        </details>
        <a href="#/check">Just looking? Check a wallet</a>
      </div>
      <p className="domain-note">
        Check the address bar: we only live at <strong className="mono">{DOMAIN}</strong>. We never ask for your seed phrase or a
        message signature.
      </p>
    </Shell>
  );
}
