// Desktop pieces for the single-card layout (768 px and wider). The phone layout never renders these.

import type { ReactNode } from 'react';
import { DOCS_URL } from '../config';

export type Mode = 'move' | 'buy' | 'check';

/** Move, Buy and Check a wallet: three modes of the same card, each its own address. */
export function DeskTabs({ at }: { at: Mode }) {
  const tabs: Array<[Mode, string, string]> = [
    ['move', 'Move', '#/'],
    ['buy', 'Buy', '#/buy'],
    ['check', 'Check a wallet', '#/check'],
  ];
  const titles: Record<Mode, string> = { move: 'Move ZEC from Solana to shielded', buy: 'Buy shielded ZEC', check: 'Check any Solana wallet' };
  return (
    <>
      <h1 className="sr-only">{titles[at]}</h1>
      <nav className="seg" aria-label="Mode">
      {tabs.map(([k, label, href]) => (
        <a key={k} href={href} aria-current={at === k ? 'page' : undefined}>
          {label}
        </a>
      ))}
      </nav>
    </>
  );
}

export function Tok({ kind, label }: { kind: 'solana' | 'zcash' | 'usdc' | 'sol'; label?: string }) {
  const name = kind === 'usdc' ? 'USDC' : kind === 'sol' ? 'SOL' : 'ZEC';
  const chain = kind === 'zcash' ? 'Zcash' : kind === 'solana' ? 'Solana' : null;
  return (
    <span className="tok">
      <span className={`tok-i ${kind}`} aria-hidden="true">
        {kind === 'zcash' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        ) : kind === 'usdc' ? (
          '$'
        ) : kind === 'sol' ? (
          'S'
        ) : (
          'Z'
        )}
      </span>
      {label ?? name}
      {chain ? <span className="tok-c">{chain}</span> : null}
    </span>
  );
}

/** One amount field: label and balance, the amount and its token, a foot line. */
export function Field({ label, right, amount, muted, token, foot, input }: {
  label: ReactNode;
  right?: ReactNode;
  amount?: ReactNode;
  muted?: boolean;
  token: ReactNode;
  foot?: ReactNode;
  input?: ReactNode;
}) {
  return (
    <div className="dfield">
      <div className="dfield-row">
        <span>{label}</span>
        {right ? <span>{right}</span> : null}
      </div>
      <div className="dfield-main">
        {input ?? <span className={`dfield-amt${muted ? ' muted' : ''}`}>{amount}</span>}
        {token}
      </div>
      {foot ? <div className="dfield-row">{foot}</div> : null}
    </div>
  );
}

/** Two fields joined by the arrow between them. */
export function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="dpair">
      {children}
      <span className="dpair-arrow" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </span>
    </div>
  );
}

/** The one line under the form: fee on the left, time on the right. */
export function Line({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="dline">
      <span>{left}</span>
      {right ? <span>{right}</span> : null}
    </div>
  );
}

/** A state shown inside the card, above the button: opening soon, below the minimum. */
export function Strip({ tone = 'amber', children }: { tone?: 'amber' | 'warn'; children: ReactNode }) {
  return (
    <div className={`dstrip ${tone}`} role="status">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        {tone === 'amber' ? <path d="M12 7v5l3 2" /> : <path d="M12 7.5v5M12 16h.01" />}
      </svg>
      <span>{children}</span>
    </div>
  );
}

/** A designed empty state inside the card. */
export function Empty({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <>
      <div className="dempty">
        <span className="dempty-i" aria-hidden="true">
          {icon}
        </span>
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
      <div className="dduo">{actions}</div>
    </>
  );
}

/** Review: what each leg makes public, in three lines, linking to the full page. */
export function PublicStrip() {
  return (
    <div className="dpub">
      <div className="dpub-h">
        <strong>What is public</strong>
        <a href={`${DOCS_URL}what-is-public`}>Full page</a>
      </div>
      <div className="dpub-g">
        <span>
          <strong>Solana</strong>
          Your wallet and the amount
        </span>
        <span>
          <strong>NEAR Intents</strong>
          That your wallet paid this Zcash address
        </span>
        <span>
          <strong>Zcash</strong>
          The amount entering the pool; after that, private
        </span>
      </div>
    </div>
  );
}

/** A back control for screens that replace the card's contents. */
export function DeskBack({ href = '#/', label = 'Back' }: { href?: string; label?: string }) {
  return (
    <a className="dback dk" href={href} aria-label={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m15 6-6 6 6 6" />
      </svg>
      {label}
    </a>
  );
}

export const WalletGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M15.5 12.5h3" />
  </svg>
);
