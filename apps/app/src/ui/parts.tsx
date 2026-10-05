import qrcode from 'qrcode-generator';
import type { ReactNode } from 'react';
import { DOCS_URL, DOMAIN } from '../config';
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

type NavKey = 'move' | 'buy' | 'counter';

export function Shell({ children, aside, nav = 'move', wide }: { children: ReactNode; aside?: ReactNode; nav?: NavKey; wide?: boolean }) {
  return (
    <>
      <header className="topbar">
        <nav aria-label="Main">
          <a href="#/" aria-current={nav === 'move' ? 'page' : undefined}>
            Move
          </a>
          <a href="#/buy" aria-current={nav === 'buy' ? 'page' : undefined}>
            Buy
          </a>
          <a href="#/counter" aria-current={nav === 'counter' ? 'page' : undefined}>
            Counter
          </a>
          <a href={DOCS_URL}>Docs</a>
        </nav>
        <span className="mono muted" style={{ fontSize: 13 }}>
          {DOMAIN}
        </span>
      </header>
      <div className="layout">
        <main className="frame">
          <div className={`phone${wide ? ' gap20' : ''}`}>{children}</div>
        </main>
        <aside className="aside">{aside}</aside>
      </div>
    </>
  );
}

export function AsideHead({ children }: { children: ReactNode }) {
  return <span className="kicker" style={{ fontSize: 12, letterSpacing: '0.08em' }}>{children}</span>;
}

export function AsideBox({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="note" style={{ fontSize: 14, borderRadius: 16, padding: 18, gap: 10 }}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
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
    <div className={`note ${tone}`} role={tone === 'err' ? 'alert' : 'status'} style={{ fontSize: 14, borderRadius: 16, padding: '14px 16px', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <strong>{title}</strong>
        {tag ? <span className="caption">{tag}</span> : null}
      </div>
      <span style={{ lineHeight: 1.5 }}>{children}</span>
      {action ? (
        <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function Rows({ rows, plain }: { rows: Array<[string, ReactNode]>; plain?: boolean }) {
  return (
    <dl className={`rows${plain ? ' plain' : ''}`}>
      {rows.map(([k, v]) => (
        <div key={k}>
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
