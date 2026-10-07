import { useEffect, useState } from 'react';
import { DOCS_URL } from '../../config';
import { duration, units } from '../../lib/format';
import { HOLDERS } from '../../lib/holders';
import { counter as fetchCounter, type Counter } from '../../lib/server';
import { Shell } from '../parts';

const n = (v: number) => v.toLocaleString('en-US');
const taken = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};

/**
 * The public counter and the dated holder tiers. Real figures only: until the first public move is counted,
 * the counter shows what it will count, never a row of dashes or example numbers.
 */
export function Stats() {
  const [c, setC] = useState<Counter | null | undefined>(undefined);
  useEffect(() => {
    const load = () => void fetchCounter().then(setC);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const live = !!c && c.moves > 0;
  const max = live ? Math.max(1, ...c!.days.map((d) => d.exits + d.buys)) : 1;
  const H = HOLDERS;
  const tiers = [
    { label: 'At or above the bridge minimum', tier: H.above, share: H.shares.above, tone: 'a', note: `${H.shares.above} of accounts, ${((H.above.zec / H.zecTotal) * 100).toFixed(2)}% of the ZEC: a plain move` },
    { label: 'Below it, worth moving', tier: H.belowButWorthMoving, share: H.shares.belowButWorthMoving, tone: 'b', note: `${H.shares.belowButWorthMoving} of accounts: the top-up in the same signature` },
    { label: 'Dust, worth less than a move costs', tier: H.dust, share: H.shares.dust, tone: 'c', note: `${H.shares.dust} of accounts, under $${H.worthMovingFromUsd.toFixed(2)} each: not worth moving` },
  ];

  return (
    <Shell nav="stats" page>
      <div className="dpage-head">
        <div>
          <h1>Stats</h1>
          <p>What ZecDoor has done, counted in public, and who holds ZEC on Solana.</p>
        </div>
        <a className="dlink" href={`${DOCS_URL}counter`}>
          How we count
        </a>
      </div>

      <div className="dgrid2">
        <section className="dcard dpanel" aria-labelledby="counted">
          <div className="dpanel-h">
            <h2 id="counted">Counted in public</h2>
            <span className="caption">{live ? 'updated every minute' : c === undefined ? '' : 'nothing counted yet'}</span>
          </div>
          {c === undefined ? (
            <div className="dstarts" aria-busy="true" />
          ) : live ? (
            <>
              <dl className="dbig">
                <div>
                  <dd>{n(c!.moves)}</dd>
                  <dt>Moves completed</dt>
                </div>
                <div>
                  <dd>{units(BigInt(c!.zecShieldedZat), 8, 2)}</dd>
                  <dt>ZEC shielded</dt>
                </div>
                <div>
                  <dd>{c!.medianSeconds ? duration(c!.medianSeconds * 1000) : '—'}</dd>
                  <dt>Median arrival</dt>
                </div>
              </dl>
              {c!.days.length ? (
                <div className="dbars">
                  <span className="caption">Moves per day</span>
                  <div className="dbars-plot" aria-hidden="true">
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
                </div>
              ) : null}
              <dl className="dsmall">
                <div>
                  <dt>Refunded</dt>
                  <dd>{n(c!.refunded)}</dd>
                </div>
                <div>
                  <dt>First Zcash wallets</dt>
                  <dd>{n(c!.firstWallets)}</dd>
                </div>
                <div>
                  <dt>Small balances moved</dt>
                  <dd>{n(c!.smallBalances)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="dstarts">
              <strong>Counting starts with the first public move.</strong>
              <span>Moves open once our own Phantom test moves pass. From then, every finished move is counted here, the day it finishes.</span>
              <ul>
                <li>
                  <span>Moves completed</span>
                  <span>each move that arrived</span>
                </li>
                <li>
                  <span>ZEC shielded</span>
                  <span>the total that arrived</span>
                </li>
                <li>
                  <span>Median arrival</span>
                  <span>signing to the shielded note</span>
                </li>
              </ul>
              <span className="dfine">
                Until then, our own mainnet test moves are on the <a href="#/proof">proof page</a>.
              </span>
            </div>
          )}
        </section>

        <section className="dcard dpanel" aria-labelledby="holders">
          <div className="dpanel-h">
            <h2 id="holders">Solana ZEC holders</h2>
            <span className="caption">{taken(H.at)}</span>
          </div>
          <p className="dlead">
            {n(H.nonEmpty)} Solana accounts held {H.zecTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ZEC.
          </p>
          {tiers.map((t) => (
            <div key={t.label} className="dtier">
              <div className="dtier-h">
                <strong>{t.label}</strong>
                <span className="mono">{n(t.tier.accounts)}</span>
              </div>
              <div className="dtier-bar">
                <span className={t.tone} style={{ width: t.share }} />
              </div>
              <span className="dfine">{t.note}</span>
            </div>
          ))}
          <span className="grow" />
          <div className="dpanel-f">
            <span>
              Source: <span className="mono">docs/{H.file}</span> · not live
            </span>
            <a href={`${DOCS_URL}holders`}>Every snapshot</a>
          </div>
        </section>
      </div>
    </Shell>
  );
}
