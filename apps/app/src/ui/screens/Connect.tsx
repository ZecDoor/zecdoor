import { useState } from 'react';
import { APP_URL, DOMAIN, MOVES_OPEN } from '../../config';
import { isMobile, phantomBrowseLink } from '../../lib/phantom';
import { Logo, Panel, Qr, Shell, Shield, StateCard, Tick } from '../parts';
import { Bullets, RoutePanel } from '../rail';
import { useApp } from '../state';
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

  return (
    <Shell
      rail={
        <>
          <RoutePanel owner={null} />
          <Panel title="On a phone?">
            <p className="sub">Scan to open this page inside Phantom’s browser, where it connects directly.</p>
            <Qr text={link} label="QR code that opens ZecDoor in Phantom" />
          </Panel>
          <Panel title="What you will need">
            <Bullets
              items={[
                'ZEC on Solana, or USDC or SOL to buy with',
                'About 0.0015 SOL for Solana fees and the deposit account',
                'A Zcash wallet, or make one here with a checked backup',
              ]}
            />
          </Panel>
        </>
      }
    >
      <div className="connect-hero">
        <div className="brand ph" style={{ minHeight: 44 }}>
          <Logo />
          ZecDoor
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.02, letterSpacing: '-0.035em', fontWeight: 600 }}>Bring your ZEC home.</h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55 }} className="muted">
            Move the ZEC you hold on Solana into your own shielded Zcash wallet. One signature.
          </p>
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15 }}>
            <li style={{ display: 'flex', gap: 10 }}>
              <Tick />
              We never hold your funds or see your keys
            </li>
            <li style={{ display: 'flex', gap: 10 }}>
              <Tick />
              No sign-message step, ever
            </li>
            <li style={{ display: 'flex', gap: 10 }}>
              <Tick />
              Open source, no token
            </li>
          </ul>
        </div>

        <div className="stack">
          {error ? (
            <StateCard tone="err" title="Not connected">
              {error}
            </StateCard>
          ) : null}
          {!MOVES_OPEN ? (
            <div className="dk">
              <StateCard tone="info" title="Opening soon" tag="Moves and buys">
                Moves and buys open once our own mainnet test moves have passed. Connect now to see your balance and a live quote.
              </StateCard>
            </div>
          ) : null}
          {supported.length ? (
            <button type="button" className="btn" onClick={() => void onConnect()} disabled={wallet$.connecting}>
              {wallet$.connecting ? `Waiting for ${direct?.name ?? 'your wallet'}…` : direct ? `Connect ${direct.name}` : 'Connect wallet'}
            </button>
          ) : isMobile() ? (
            <a className="btn" href={link}>
              Open in Phantom
            </a>
          ) : (
            <a className="btn" href="https://phantom.com/download" target="_blank" rel="noreferrer">
              Get Phantom
            </a>
          )}
          {supported.length ? null : (
            <a className="textlink" href={link}>
              Not in Phantom? Open this page in Phantom
            </a>
          )}
          <div className="note" style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: '14px 16px' }}>
            <Shield />
            <span>
              Check the address bar: we only live at <strong className="mono">{DOMAIN}</strong>. We will never ask for your seed phrase or
              for a message signature.
            </span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
