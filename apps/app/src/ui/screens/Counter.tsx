import { useEffect, useState } from 'react';
import { SOURCE_PENDING, SOURCE_URL } from '../../config';
import { duration, units } from '../../lib/format';
import { counter as fetchCounter, type Counter as Data } from '../../lib/server';
import { Panel, Shell } from '../parts';
import { FaqPanel, FeesPanel, FirstRun } from '../extras';
import { Bullets } from '../rail';

/** Public totals from our own records. Placeholders until real moves exist. */
export function Counter() {
  const [c, setC] = useState<Data | null>(null);
  useEffect(() => {
    const load = () => void fetchCounter().then(setC);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const live = !!c && c.moves > 0;
  const n = (v: number | undefined) => (live && v !== undefined ? v.toLocaleString('en-US') : '—');
  const stats: Array<[string, string]> = [
    ['Moves completed', n(c?.moves)],
    ['ZEC shielded', live ? units(BigInt(c!.zecShieldedZat), 8, 2) : '—'],
    ['First Zcash wallets', n(c?.firstWallets)],
    ['Small balances rescued', n(c?.smallBalances)],
  ];
  const max = live ? Math.max(1, ...c!.days.map((d) => d.exits + d.buys)) : 1;

  return (
    <Shell
      nav="counter"
      rail={
        <>
          <Panel title="Why count at all">
            <p className="sub">So anyone can see whether ZecDoor is used, without us keeping anything that points at a person.</p>
          </Panel>
          <Panel title="Never kept">
            <Bullets items={['Solana or Zcash addresses', 'Transaction IDs', 'IP addresses or device IDs', 'Anything after a move’s 24-hour duplicate check']} />
          </Panel>
          <FirstRun />
          <FeesPanel minimum={null} />
          <FaqPanel />
        </>
      }
      wide
    >
      <div className="bar">
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Public counter</h1>
        <span className="caption">Updated every minute</span>
      </div>
      <div className="stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <span className="v">{v}</span>
            <span className="k">{k}</span>
          </div>
        ))}
      </div>

      <div className="card plain tight">
        <span style={{ fontSize: 15, fontWeight: 600 }}>Moves per day</span>
        {live && c!.days.length ? (
          <>
            <div className="bars" aria-hidden="true">
              {c!.days.map((d) => (
                <span key={d.day} style={{ height: `${((d.exits + d.buys) / max) * 100}%` }} />
              ))}
            </div>
            <ul className="sr-only">
              {c!.days.map((d) => (
                <li key={d.day}>
                  {d.day}: {d.exits + d.buys} moves
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 14, border: '1px dashed var(--line)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            Fills in from launch day. No numbers until there are real ones.
          </div>
        )}
      </div>

      <dl className="rows plain">
        <div>
          <dt>Refunded</dt>
          <dd>{n(c?.refunded)}</dd>
        </div>
        <div>
          <dt>Median time to arrive</dt>
          <dd>{live && c!.medianSeconds ? duration(c!.medianSeconds * 1000) : '—'}</dd>
        </div>
      </dl>

      <div className="note">
        <strong>How we count</strong>
        <span>
          When a move this page built finishes, our server reads its result from NEAR Intents and, if it succeeded and carries our fee, adds one to a
          running total and adds its amount. We keep only those totals per day and route — never a Solana or Zcash address, a transaction ID, an IP
          address or a device ID. To avoid counting a move twice, a one-way hash of its deposit address is kept for 24 hours, then deleted.
          {SOURCE_URL ? ' The counting code is public.' : ''}
        </span>
        {SOURCE_URL ? (
          <a href={`${SOURCE_URL}/tree/main/apps/server`} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', marginTop: 4 }}>
            Read the counting code
          </a>
        ) : (
          <span className="muted" style={{ marginTop: 4 }}>{SOURCE_PENDING}.</span>
        )}
      </div>
    </Shell>
  );
}
