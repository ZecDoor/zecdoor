import qrcode from 'qrcode-generator';
import { useId, useState, type ReactNode } from 'react';
import { DOCS_URL, DOMAIN } from '../config';
import { Footer } from './extras';
import { WalletButton, WalletPicker } from './wallet-ui';
import { go } from './router';

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M4 12.5 14 4l10 8.5V24H4V12.5Z" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 18h10" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const Tick = ({ color = 'var(--ok)', size = 20 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="m8 5 5 5-5 5" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Shield = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
    <path d="M10 2 3 5v5c0 4 3 7 7 8 4-1 7-4 7-8V5l-7-3Z" stroke="var(--muted)" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const CheckCircle = ({ color = 'var(--ok)' }: { color?: string }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
    <circle cx="11" cy="11" r="9.25" stroke={color} strokeWidth="1.5" />
    <path d="m7 11.5 2.8 2.8L15.5 8" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Pending = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
    <circle cx="11" cy="11" r="9.25" stroke="var(--line)" strokeWidth="1.5" />
    <path d="M11 6.5V11l3 2" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function BackBar({ title, step, back }: { title: string; step?: string; back?: string | (() => void) }) {
  const onBack = () => (typeof back === 'function' ? back() : back !== undefined ? go(back) : history.back());
  return (
    <div className="bar-title">
      <button type="button" className="back" aria-label="Back" onClick={onBack}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="m13.5 5-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1>{title}</h1>
      {step ? <span className="step">{step}</span> : null}
    </div>
  );
}

type NavKey = 'move' | 'buy' | 'check' | 'counter' | 'activity' | 'stats';

/**
 * Every screen, on every size: the top bar, then one 480 px column centred in the window — a card by default,
 * or a plain column (`plain`), or a wide page (`page`, Activity and Stats) — and a slim footer. `hero` sits above
 * the card. On a phone the column fills the width; from 1700 px the whole layout scales up (styles.css).
 */
export function Shell({ children, nav = 'move', hero, plain, page }: { children: ReactNode; nav?: NavKey; wide?: boolean; hero?: ReactNode; plain?: boolean; page?: boolean }) {
  return (
    <div className="app dapp">
      <TopBar nav={nav} />
      <main className="dmain">
        {hero ? <div className="dhero">{hero}</div> : null}
        <div className={page ? 'dpage' : plain ? 'dcol' : 'dcard'}>{children}</div>
      </main>
      <Footer />
      <WalletPicker />
    </div>
  );
}

function TopBar({ nav }: { nav: NavKey }) {
  const app = nav === 'move' || nav === 'buy' || nav === 'check';
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <Logo size={22} />
        ZecDoor
      </a>
      <nav aria-label="Main">
        <a href="#/" aria-current={app ? 'page' : undefined}>
          App
        </a>
        <a href="#/activity" aria-current={nav === 'activity' ? 'page' : undefined}>
          Activity
        </a>
        <a href="#/stats" aria-current={nav === 'stats' || nav === 'counter' ? 'page' : undefined}>
          Stats
        </a>
        <a href={DOCS_URL}>Docs</a>
      </nav>
      <span className="grow" />
      <span className="domain mono">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        {DOMAIN}
      </span>
      <WalletButton />
    </header>
  );
}

export function Qr({ text, label }: { text: string; label: string }) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const svg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export type Tone = 'warn' | 'err' | 'info' | 'ok';

/** One of the states from the design's "Every state a user can hit" board. */
export function StateCard({ tone, title, tag, children, action, onAction }: {
  tone: Tone;
  title: string;
  tag?: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`state ${tone}`} role={tone === 'err' ? 'alert' : 'status'}>
      <ToneIcon tone={tone} />
      <div className="state-body">
        <div className="state-head">
          <strong>{title}</strong>
          {tag ? <span className="caption">{tag}</span> : null}
        </div>
        <span>{children}</span>
        {action ? (
          <button type="button" className="btn ghost sm" onClick={onAction}>
            {action}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ToneIcon({ tone }: { tone: Tone }) {
  return (
    <svg className="tone-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {tone === 'ok' ? <path d="m8 12.5 2.8 2.8L16 10" /> : tone === 'info' ? <path d="M12 7v5l3 2" /> : <path d="M12 7.5v5M12 16h.01" />}
    </svg>
  );
}

/** An explanation opened by tap, click or keyboard: never a hover-only tooltip. */
export function Explain({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="explain" aria-expanded={open} aria-controls={id} aria-label={`About ${label}`} onClick={() => setOpen(!open)}>
        ?
      </button>
      {open ? (
        <span id={id} className="explained">
          {children}
        </span>
      ) : null}
    </>
  );
}

export function Rows({ rows, plain }: { rows: Array<[ReactNode, ReactNode]>; plain?: boolean }) {
  return (
    <dl className={`rows${plain ? ' plain' : ''}`}>
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="muted" role="status" style={{ margin: 0, fontSize: 15 }}>
      {label}
    </p>
  );
}
