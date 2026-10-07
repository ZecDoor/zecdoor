import { useEffect, useState } from 'react';
import { clock, duration, short, usdc, sol, zec } from '../../lib/format';
import { refundReason } from '../../lib/move';
import type { MoveRecord } from '../../lib/store';
import { Shell } from '../parts';
import { WalletGlyph } from '../desk';
import { useApp } from '../state';

type Group = 'all' | 'progress' | 'arrived' | 'refunded' | 'failed';

function group(m: MoveRecord): Exclude<Group, 'all'> {
  if (m.status === 'SUCCESS') return 'arrived';
  if (m.status === 'REFUNDED') return 'refunded';
  if (m.status === 'FAILED') return 'failed';
  return 'progress';
}

const CHIP: Record<Exclude<Group, 'all'>, { label: string; tone: string }> = {
  progress: { label: 'In progress', tone: 'info' },
  arrived: { label: 'Arrived', tone: 'ok' },
  refunded: { label: 'Refunded', tone: 'warn' },
  failed: { label: 'Failed', tone: 'err' },
};

const when = (t: number) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function row(m: MoveRecord, now: number) {
  const g = group(m);
  const buy = m.kind === 'buyUsdc' || m.kind === 'buySol';
  const what = buy ? `Bought ${zec(BigInt(m.arrival?.value ?? m.amountOut), 0)}` : `${zec(BigInt(m.amountIn))} → shielded`;
  const paid = m.paid ? (m.paid.symbol === 'USDC' ? usdc(BigInt(m.paid.amount)) : sol(BigInt(m.paid.amount))) : null;
  const sub = buy ? `Paid ${paid ?? (m.kind === 'buyUsdc' ? usdc(BigInt(m.amountIn)) : sol(BigInt(m.amountIn)))}` : m.kind === 'topup' ? 'Top-up and move, one signature' : 'Move from Solana';
  const dest = m.recipientIndex !== null ? 'Wallet in this browser' : 'Your wallet';
  const addr = m.recipientIndex !== null ? `address ${m.recipientIndex} · ${short(m.recipient, 4, 4)}` : `pasted · ${short(m.recipient, 4, 4)}`;
  const note =
    g === 'arrived'
      ? m.arrival
        ? 'Found by this browser.'
        : m.recipientIndex === null
          ? 'Paid to your address. Your wallet shows it.'
          : 'Sent on Zcash. This browser is still looking for it.'
      : g === 'refunded'
        ? `${refundReason(m.refund?.reason)}. Refunded to ${short(m.owner, 4, 4)}.`
        : g === 'failed'
          ? 'NEAR Intents reported a failure. Keep the deposit address for their support.'
          : m.status === 'PENDING_DEPOSIT'
            ? 'Waiting for NEAR Intents to see the deposit.'
            : m.status === 'INCOMPLETE_DEPOSIT'
              ? 'Short deposit. It is refunded at the quote’s deadline.'
              : 'NEAR Intents is paying out on Zcash.';
  const took =
    g === 'arrived' && m.completedAt
      ? `took ${duration(m.completedAt - m.createdAt)}`
      : g === 'progress'
        ? `${clock(now - m.createdAt)} so far`
        : g === 'refunded'
          ? 'refunded'
          : '';
  const link = { arrived: 'Proof', progress: 'Track', refunded: 'Refund', failed: 'Details' }[g];
  return { key: m.depositAddress, g, what, sub, dest, addr, note, when: when(m.createdAt), took, link };
}

/** The moves and buys made in this browser, kept only here (IndexedDB), with their status and a link to each record. */
export function Activity() {
  const { moves, movesReady, reloadMoves } = useApp();
  const [filter, setFilter] = useState<Group>('all');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void reloadMoves();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [reloadMoves]);

  const count = (g: Group) => (g === 'all' ? moves.length : moves.filter((m) => group(m) === g).length);
  const shown = moves.filter((m) => filter === 'all' || group(m) === filter).map((m) => row(m, now));
  const filters: Array<[Group, string]> = [
    ['all', 'All'],
    ['progress', 'In progress'],
    ['arrived', 'Arrived'],
    ['refunded', 'Refunded'],
    ['failed', 'Failed'],
  ];

  return (
    <Shell nav="activity" page>
      <div className="dpage-head">
        <div>
          <h1>Activity</h1>
          <p>Your moves and buys, kept in this browser only. Nothing here is sent to our server.</p>
        </div>
        {moves.length ? (
          <div className="pills" role="group" aria-label="Filter by status">
            {filters.map(([g, label]) => (
              <button key={g} type="button" aria-pressed={filter === g} onClick={() => setFilter(g)}>
                {label} <span className="mono">{count(g)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!movesReady ? null : moves.length === 0 ? (
        <div className="dcard dempty-card">
          <div className="dempty">
            <span className="dempty-i" aria-hidden="true">
              <WalletGlyph />
            </span>
            <strong>No moves in this browser yet</strong>
            <span>Each move or buy you make here appears in this list with its amount, where it landed, its status and a link to its proof. The list stays in this browser.</span>
          </div>
          <div className="dduo">
            <a className="btn" href="#/">
              Move ZEC to shielded
            </a>
            <a className="btn ghost" href="#/buy">
              Buy shielded ZEC
            </a>
          </div>
          <span className="dfine">Moved from another browser or phone? Its moves are listed there.</span>
        </div>
      ) : (
        <>
          <div className="dtable-box">
            <table className="dtable">
              <thead>
                <tr>
                  <th scope="col">Move</th>
                  <th scope="col">Lands in</th>
                  <th scope="col">Status</th>
                  <th scope="col">When</th>
                  <th scope="col" className="r">
                    Record
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong className="num">{r.what}</strong>
                      <span className="sub">{r.sub}</span>
                    </td>
                    <td>
                      <span>{r.dest}</span>
                      <span className="sub mono">{r.addr}</span>
                    </td>
                    <td>
                      <span className={`schip ${CHIP[r.g].tone}`}>{CHIP[r.g].label}</span>
                      <span className="sub">{r.note}</span>
                    </td>
                    <td className="mono">
                      <span>{r.when}</span>
                      <span className="sub">{r.took}</span>
                    </td>
                    <td className="r">
                      <a href={`#/move/${r.key}`}>{r.link}</a>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="none">
                      No {filters.find(([g]) => g === filter)![1].toLowerCase()} moves.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="dfine">Each browser keeps its own list. Clearing this site’s data removes it; the transactions stay on their chains.</p>
        </>
      )}
    </Shell>
  );
}
