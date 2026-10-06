// Content that uses the desktop's extra room: what a move looks like, our own first mainnet move,
// the public counter, fees and minimums, common questions, and the footer. Real numbers only:
// every figure here is either read live or comes from the B1 run recorded on the testing page.

import { useEffect, useId, useState } from 'react';
import { DOCS_URL, PRIVACY_URL, SOURCE_URL, TERMS_URL } from '../config';
import { duration, units, zec } from '../lib/format';
import { counter as fetchCounter, type Counter } from '../lib/server';
import { Panel } from './parts';
import { FEE_RUN_URL, PanelRows } from './rail';

const B1 = {
  solana: '2ZfeRtsivSk7UCrsTenJ5dL1GoArXyK2aCRH1RE8uFUR6XMEgjvVBLtc1JWnigb44FBTbauSvqc3xtBUmJJ9ZQLa',
  zcash: '2fac74310c294c306f56bb9d60891af9d0f8f2ff9c4244f77e1939cf7df206d6',
};

/** The three steps of a move, timed on our first mainnet move (B1, 5 Oct 2026). */
export function MoveSteps() {
  const steps: Array<[string, string, string]> = [
    ['0:00', 'You sign once', 'One Solana transaction, checked and simulated before your wallet sees it.'],
    ['2:15', 'NEAR Intents pays out on Zcash', 'It receives the Solana ZEC and sends native ZEC to your shielded address.'],
    ['2:16', 'Your browser finds the note', 'With a viewing key that can see the payment but not spend it.'],
  ];
  return (
    <section className="panel">
      <h2>
        <span>A move, in three steps</span>
        <span className="cap">timed on our first mainnet move</span>
      </h2>
      <ol className="tl">
        {steps.map(([t, h, d], i) => (
          <li key={h}>
            <span className="n">{i + 1}</span>
            <span>
              <span className="h">{h}</span>
              <span className="d">{d}</span>
            </span>
            <span className="r">{t}</span>
          </li>
        ))}
      </ol>
      <p className="sub">NEAR Intents usually takes 3–9 minutes in total. Times are minutes:seconds after signing.</p>
    </section>
  );
}

/** A link to the proof of our own first mainnet move. */
export function FirstRun() {
  return (
    <section className="panel">
      <h2>
        <span>Our own first mainnet move</span>
        <span className="cap">5 Oct 2026</span>
      </h2>
      <PanelRows
        rows={[
          ['Started with', '0.0003 ZEC (below the minimum)'],
          ['Topped up and moved', '0.00133669 ZEC, one signature'],
          ['Arrived shielded', '0.00108335 ZEC'],
          [
            'Solana',
            <a key="s" href={`https://solscan.io/tx/${B1.solana}`} target="_blank" rel="noreferrer">
              2ZfeRt…J9ZQLa
            </a>,
          ],
          [
            'Zcash',
            <a key="z" href={`https://blockchair.com/zcash/transaction/${B1.zcash}`} target="_blank" rel="noreferrer">
              2fac74…f206d6
            </a>,
          ],
        ]}
      />
      <a className="lnk" href={FEE_RUN_URL}>
        Every transaction, with the checks we ran
      </a>
    </section>
  );
}

export function useCounter(): Counter | null {
  const [c, setC] = useState<Counter | null>(null);
  useEffect(() => {
    const load = () => void fetchCounter().then(setC);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  return c;
}

/** Live public totals and the most recent days, from our counter. Placeholders until real moves. */
export function CounterPanel() {
  const c = useCounter();
  const live = !!c && c.moves > 0;
  const days = live ? c!.days.filter((d) => d.exits + d.buys > 0).slice(-4).reverse() : [];
  return (
    <Panel title="Counted in public" cap="totals only">
      <div className="mini-stats">
        <div>
          <span className="v">{live ? c!.moves.toLocaleString('en-US') : '—'}</span>
          <span className="k">moves completed</span>
        </div>
        <div>
          <span className="v">{live ? units(BigInt(c!.zecShieldedZat), 8, 2) : '—'}</span>
          <span className="k">ZEC shielded</span>
        </div>
        <div>
          <span className="v">{live && c!.medianSeconds ? duration(c!.medianSeconds * 1000) : '—'}</span>
          <span className="k">median arrival</span>
        </div>
      </div>
      {days.length ? (
        <PanelRows rows={days.map((d) => [d.day, `${d.exits} moves · ${d.buys} buys`])} />
      ) : (
        <p className="sub">Fills in once moves open to everyone. No numbers until there are real ones; no address or transaction is ever kept.</p>
      )}
      <a className="lnk" href="#/counter">
        The counter
      </a>
    </Panel>
  );
}

/** Fees and minimums in plain numbers. */
export function FeesPanel({ minimum }: { minimum: bigint | null }) {
  return (
    <Panel title="Fees and minimums">
      <PanelRows
        plain
        rows={[
          ['Smallest move', minimum ? `${zec(minimum)} (read now)` : '0.00133669 ZEC (6 Oct 2026)'],
          ['Below that', 'top up with SOL or USDC in the same signature'],
          ['Smallest buy', 'about 1.80 USDC (6 Oct 2026)'],
          ['Our fee', '0.25% on moves, 0.5% on buys'],
          ['Bridge network fee', 'up to 0.00032 ZEC'],
          ['Solana', '≈ 0.0015 SOL deposit account + ≈ 0.00001 SOL fee'],
        ]}
      />
      <a className="lnk" href={`${DOCS_URL}fees`}>
        Every fee and who receives it
      </a>
    </Panel>
  );
}

const QUESTIONS: Array<[string, string]> = [
  ['Does ZecDoor ever hold my funds or keys?', 'No. Your wallet signs one transaction to a NEAR Intents deposit address, and NEAR Intents pays your Zcash address. Our server never sees a key or holds a coin.'],
  [
    'What stays public?',
    'The Solana transaction and its amount, the amount and time your ZEC enters the shielded pool, and, on NEAR Intents’ explorer, that your Solana wallet paid that Zcash address. What you do with the ZEC after it lands is private.',
  ],
  ['What if a move can’t complete?', 'NEAR Intents refunds the Solana wallet that sent it. In our own test of a short deposit, the refund came at the quote’s deadline, 31 minutes later.'],
  ['My balance is below the bridge minimum.', 'ZecDoor swaps just enough SOL or USDC into ZEC and moves all of it, in the same single signature. If your balance is worth less than one move costs in fees, the app says so first: moving it would cost more than it is worth.'],
  ['Which wallets work?', 'Phantom, tested end to end on mainnet. Other Solana wallets are listed but cannot be picked until each passes the same test.'],
  ['How do I spend it later?', 'Restore the wallet in Zodl or Zkool with your 24 words and the birthday height. ZecDoor never spends.'],
];

/** Common questions, each opened by click, tap or keyboard. */
export function FaqPanel() {
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();
  return (
    <Panel title="Common questions" full>
      <ul className="faq">
        {QUESTIONS.map(([q, a], i) => (
          <li key={q}>
            <button type="button" aria-expanded={open === i} aria-controls={`${base}-${i}`} onClick={() => setOpen(open === i ? null : i)}>
              <span>{q}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d={open === i ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
              </svg>
            </button>
            {open === i ? (
              <p id={`${base}-${i}`} className="sub">
                {a}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Desktop footer: always at the bottom of the window. */
export function Footer() {
  return (
    <footer className="foot">
      <span>ZecDoor · open source (MIT) · no token</span>
      <span className="grow" />
      <a href={DOCS_URL}>Docs</a>
      <a href={`${DOCS_URL}what-is-public`}>What is public</a>
      <a href={`${DOCS_URL}testing`}>Mainnet tests</a>
      {SOURCE_URL ? (
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source
        </a>
      ) : null}
      <a href="https://x.com/ZecDoor" target="_blank" rel="noreferrer">
        @ZecDoor
      </a>
      <a href={TERMS_URL}>Terms</a>
      <a href={PRIVACY_URL}>Privacy</a>
    </footer>
  );
}
