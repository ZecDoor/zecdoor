// Context panels for the rail beside the action column (768 px and wider). Real values only:
// anything not known yet is left out rather than shown as an example.

import type { MoveKind } from '@zecdoor/solana';
import { useEffect, useState, type ReactNode } from 'react';
import { DOCS_URL } from '../config';
import { day, short, zec } from '../lib/format';
import type { MoveRecord } from '../lib/store';
import { Explain, Panel } from './parts';
import { statusLabel } from './screens/Move';

/** Our first mainnet move, where the payout cost less than the quote's figure. */
export const FEE_RUN_URL = `${DOCS_URL}testing#mainnet-transactions`;

/** True from 768 px, where the rail is shown; used to skip work the phone layout never shows. */
export function useWide(): boolean {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// ---------------------------------------------------------------- the route

type StopState = 'todo' | 'done' | 'now' | 'ok' | 'fail';
export interface Stop {
  icon: 'wallet' | 'bridge' | 'lock' | 'swap';
  t: string;
  s: string;
  pub?: string;
  prv?: string;
  state?: StopState;
}

const ICONS: Record<Stop['icon'], ReactNode> = {
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M15.5 12.5h3" />
    </>
  ),
  bridge: (
    <>
      <path d="M4 8.5h15l-3.5-3.5" />
      <path d="M20 15.5H5l3.5 3.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  swap: (
    <>
      <path d="M7 4v13l-3-3" />
      <path d="M17 20V7l3 3" />
    </>
  ),
};

export function RouteMap({ stops }: { stops: Stop[] }) {
  return (
    <ol className="route" style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }}>
      {stops.map((st) => (
        <li key={st.t} className="stop">
          <span className={`node ${st.state ?? 'todo'}`}>
            {st.state === 'done' || st.state === 'ok' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="m6 12.5 4 4L18 8" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {ICONS[st.icon]}
              </svg>
            )}
          </span>
          <span className="t">{st.t}</span>
          <span className="s">{st.s}</span>
          {st.pub ? <span className="pub">{st.pub}</span> : null}
          {st.prv ? <span className="prv">{st.prv}</span> : null}
        </li>
      ))}
    </ol>
  );
}

const isBuy = (k: MoveKind) => k === 'buyUsdc' || k === 'buySol';

/** The three legs of a move and what is public at each. */
export function routeStops(kind: MoveKind, owner: string | null, dest: string, states?: [StopState, StopState, StopState]): Stop[] {
  const asset = kind === 'buySol' ? 'SOL' : kind === 'buyUsdc' ? 'USDC' : 'ZEC';
  return [
    {
      icon: 'wallet',
      t: 'Solana',
      s: isBuy(kind) ? `${asset} from your wallet` : owner ? `Your wallet ${short(owner, 4, 3)}` : 'Your wallet',
      pub: 'Public: your transfer and its amount',
      ...(states ? { state: states[0] } : {}),
    },
    {
      icon: 'bridge',
      t: 'NEAR Intents',
      s: isBuy(kind) ? `Swaps ${asset} to ZEC` : 'One-time deposit address',
      pub: 'Public: which Zcash address you paid, and our fee',
      ...(states ? { state: states[1] } : {}),
    },
    {
      icon: 'lock',
      t: 'Zcash shielded pool',
      s: dest,
      pub: 'Public: amount and time it enters',
      prv: 'Private after arrival',
      ...(states ? { state: states[2] } : {}),
    },
  ];
}

export function RoutePanel({ kind = 'exit', owner, dest = 'A wallet only you control', title = 'The route', cap = 'what is public at each leg', states }: {
  kind?: MoveKind;
  owner: string | null;
  dest?: string;
  title?: string;
  cap?: ReactNode;
  states?: [StopState, StopState, StopState];
}) {
  return (
    <Panel title={title} cap={cap} full>
      <RouteMap stops={routeStops(kind, owner, dest, states)} />
    </Panel>
  );
}

// ---------------------------------------------------------------- what is public

export function PublicPanel({ owner, recipient, full }: { owner?: string | null; recipient?: string; full?: boolean }) {
  return (
    <Panel title="What stays public" full={!!full}>
      <ul className="plist">
        <li>
          <b>Solana</b>
          <span>This amount and time{owner ? `, from ${short(owner, 4, 3)}` : ''}</span>
        </li>
        <li>
          <b>NEAR Intents' explorer</b>
          <span>That this wallet paid {recipient ? short(recipient, 4, 4) : 'your Zcash address'}, and our fee (which groups ZecDoor moves)</span>
        </li>
        <li>
          <b>Shielded pool</b>
          <span>The amount and time it enters</span>
        </li>
        <li className="ok">
          <b>Private</b>
          <span>Everything you do with it after it lands</span>
        </li>
      </ul>
      <a className="lnk" href={`${DOCS_URL}what-is-public`}>
        The full explanation, with sources
      </a>
    </Panel>
  );
}

// ---------------------------------------------------------------- fees

/** The bridge's payout fee as quoted: a ceiling, not an exact charge. */
export function NetworkFeeLabel() {
  return (
    <span className="with-explain">
      Bridge network{' '}
      <span className="fee-max">
        fee
        <Explain label="the bridge network fee">
          The most NEAR Intents charges to pay out on Zcash, as set in its quote. It can cost less: on our first mainnet move the payout cost 0.00025
          ZEC against 0.00032 in the quote, so more arrived than the minimum. <a href={FEE_RUN_URL}>The run</a>. What you are promised is the minimum
          shown.
        </Explain>
      </span>
    </span>
  );
}

export const networkFee = (withdrawFee?: string) => (withdrawFee ? <span className="fee-max">up to {zec(BigInt(withdrawFee), 0)}</span> : '—');

/** A list of label/value rows inside a panel. */
export function PanelRows({ rows, plain }: { rows: Array<[ReactNode, ReactNode]>; plain?: boolean }) {
  return (
    <dl className={`prows${plain ? ' plain' : ''}`}>
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- recent moves

export function RecentPanel({ moves, owner, exclude }: { moves: MoveRecord[]; owner: string | null; exclude?: string }) {
  const mine = moves.filter((m) => (!owner || m.owner === owner) && m.depositAddress !== exclude).slice(0, 5);
  return (
    <Panel title="Recent moves" cap="kept in this browser only" full>
      {mine.length === 0 ? (
        <p className="sub">None yet. Each move you make appears here with its status and proof.</p>
      ) : (
        <ul className="hist">
          {mine.map((m) => {
            const s = statusLabel(m);
            return (
              <li key={m.depositAddress}>
                <a href={`#/move/${m.depositAddress}`}>
                  <span>
                    {isBuy(m.kind) ? `Bought ${zec(BigInt(m.amountOut))}` : `${zec(BigInt(m.amountIn))} → shielded`}
                    <span className="muted"> · to {m.recipientIndex === null ? short(m.recipient, 4, 4) : 'this browser’s wallet'}</span>
                  </span>
                  <span style={{ color: s.color }}>
                    {s.text} · {day(m.createdAt)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** A short ordered list of plain statements (what a transaction may do, what not to do...). */
export function Bullets({ items, tone }: { items: ReactNode[]; tone?: 'ok' | 'warn' }) {
  return (
    <ul className={`bullets${tone ? ` ${tone}` : ''}`}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
