import { useState } from 'react';
import { APP_URL, DOMAIN } from '../../config';
import { isMobile, phantomBrowseLink } from '../../lib/phantom';
import { AsideBox, AsideHead, Logo, Qr, Shell, Shield, StateCard, Tick } from '../parts';
import { useApp } from '../state';

export function Connect() {
  const { provider, connect } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = phantomBrowseLink(APP_URL);

  const onConnect = async () => {
    setError(null);
    setBusy(true);
    try {
      await connect();
    } catch {
      setError('Phantom did not connect. Open Phantom and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      aside={
        <>
          <AsideHead>On a computer?</AsideHead>
          <p>Use the Phantom browser extension. Everything works the same, and the view-only check runs in this tab.</p>
          <AsideBox title="Rather use your phone?">
            <span>Scan to open this page inside Phantom mobile.</span>
            <Qr text={link} label="QR code that opens ZecDoor in Phantom" />
          </AsideBox>
        </>
      }
    >
      <div style={{ minHeight: 'calc(100dvh - 40px)', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="brand" style={{ minHeight: 44 }}>
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
          {provider ? (
            <button type="button" className="btn" onClick={onConnect} disabled={busy}>
              {busy ? 'Waiting for Phantom…' : 'Connect Phantom'}
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
          {provider ? null : (
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
