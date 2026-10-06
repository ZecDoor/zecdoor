import { quoteHash, verifyQuoteSignature } from '@zecdoor/solana';
import { useEffect, useRef, useState } from 'react';
import { NEAR_SUPPORT_URL, QUOTE_KEY, SLOW_AFTER_MS, STATUS_POLL_MS } from '../../config';
import { clock, day, duration, height, short, sol, usdc, zec } from '../../lib/format';
import { checkArrival, refreshStatus, refundReason } from '../../lib/move';
import { getMove, type MoveRecord } from '../../lib/store';
import { CheckCircle, Panel, Pending, Rows, Shell, Spinner, StateCard } from '../parts';
import { Bullets, PanelRows, RecentPanel, RoutePanel } from '../rail';
import { go } from '../router';
import { useApp } from '../state';

export const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;
export const zcashTx = (txid: string) => `https://blockchair.com/zcash/transaction/${txid}`;

const ARRIVAL_POLL_MS = 20_000;

export function isDone(m: MoveRecord): boolean {
  return m.status === 'REFUNDED' || m.status === 'FAILED' || (m.status === 'SUCCESS' && (m.recipientIndex === null || !!m.arrival));
}

export function statusLabel(m: MoveRecord): { text: string; color: string } {
  if (m.status === 'SUCCESS') return { text: m.arrival || m.recipientIndex === null ? 'Arrived' : 'Sent on Zcash', color: 'var(--ok)' };
  if (m.status === 'REFUNDED') return { text: 'Refunded', color: 'var(--err)' };
  if (m.status === 'FAILED') return { text: 'Failed', color: 'var(--err)' };
  if (m.status === 'INCOMPLETE_DEPOSIT') return { text: 'Short deposit', color: 'var(--warn)' };
  return { text: 'In progress', color: 'var(--info)' };
}

const sent = (m: MoveRecord) =>
  m.kind === 'buyUsdc' ? usdc(BigInt(m.amountIn)) : m.kind === 'buySol' ? sol(BigInt(m.amountIn)) : zec(BigInt(m.amountIn));

export function MoveScreen({ id }: { id: string }) {
  const { wallet } = useApp();
  const [m, setM] = useState<MoveRecord | null | undefined>(undefined);
  const [stale, setStale] = useState(false);
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    void getMove(id).then((r) => setM(r ?? null));
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Status from 1Click every few seconds until the move is final; then the arrival check.
  useEffect(() => {
    if (!m || isDone(m)) return;
    let live = true;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        let next = m;
        if (m.status !== 'SUCCESS') next = await refreshStatus(m);
        if (next.status === 'SUCCESS' && next.recipientIndex !== null && wallet && !next.arrival) {
          next = await checkArrival(next, wallet, (h) => live && setScanAt(h));
        }
        if (live) {
          setM(next);
          setStale(false);
        }
      } catch {
        if (live) setStale(true);
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, m.status === 'SUCCESS' ? ARRIVAL_POLL_MS : STATUS_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [m?.status, m?.arrival, wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  if (m === undefined) return <Shell><Spinner label="Loading…" /></Shell>;
  if (m === null)
    return (
      <Shell>
        <StateCard tone="warn" title="Not on this device" action="Back to start" onAction={() => go('/')}>
          This move is not in this browser’s history. Moves are kept only on the device that made them.
        </StateCard>
      </Shell>
    );

  if (m.status === 'REFUNDED') return <Refund m={m} />;
  if (m.status === 'SUCCESS' && (m.arrival || m.recipientIndex === null)) return <Proof m={m} />;
  return <Progress m={m} now={now} stale={stale} scanAt={scanAt} hasWallet={!!wallet} />;
}

function Progress({ m, now, stale, scanAt, hasWallet }: { m: MoveRecord; now: number; stale: boolean; scanAt: number | null; hasWallet: boolean }) {
  const { moves } = useApp();
  const seen = ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'].includes(m.status);
  const converting = m.status === 'KNOWN_DEPOSIT_TX' || m.status === 'PROCESSING';
  const slow = now - m.statusSince > SLOW_AFTER_MS && m.status !== 'SUCCESS' && m.status !== 'FAILED';
  type S = 'done' | 'active' | 'todo' | 'stuck';
  const st = (done: boolean, active: boolean): S => (done ? 'done' : active ? (slow ? 'stuck' : 'active') : 'todo');
  const steps: Array<{ s: S; title: string; body: string }> = [
    { s: st(!!m.solanaSignature, !m.solanaSignature), title: 'Signed in Phantom', body: m.solanaSignature ? `Solana transaction ${short(m.solanaSignature, 4, 4)} sent` : 'Waiting for your signature' },
    { s: st(seen, !seen), title: 'Received by the bridge', body: seen ? 'NEAR Intents saw your deposit' : 'Waiting for NEAR Intents to see your deposit' },
    { s: st(m.status === 'SUCCESS', converting), title: 'Converting to native ZEC', body: 'NEAR Intents is releasing ZEC on the Zcash chain' },
    { s: st(!!m.zcashTxid, false), title: 'Sent on Zcash', body: m.zcashTxid ? `Zcash transaction ${short(m.zcashTxid, 4, 4)}` : 'We show the Zcash transaction as soon as it exists' },
    {
      s: st(!!m.arrival, m.status === 'SUCCESS'),
      title: 'Found in your wallet',
      body:
        m.recipientIndex === null
          ? 'Open your wallet app to see it; this page cannot look inside a wallet it did not make'
          : !hasWallet
            ? 'This browser no longer has the viewing key; open your 24 words in Zodl or Zkool to see it'
            : m.status === 'SUCCESS'
              ? `Your browser is checking the shielded pool${scanAt ? ` · block ${height(scanAt)}` : ''}`
              : 'Your browser checks the shielded pool for your note',
    },
  ];

  const failed = m.status === 'FAILED';
  const dest = m.recipientIndex === null ? `${short(m.recipient, 4, 4)} · your wallet` : 'Your wallet in this browser';
  return (
    <Shell
      rail={
        <>
          <RoutePanel
            kind={m.kind}
            owner={m.owner}
            dest={dest}
            title="Where your ZEC is now"
            cap={`live from NEAR Intents · every ${STATUS_POLL_MS / 1000} s`}
            states={[m.solanaSignature ? 'done' : 'now', failed ? 'fail' : m.status === 'SUCCESS' ? 'done' : seen ? 'now' : 'todo', m.status === 'SUCCESS' ? 'now' : 'todo']}
          />
          <Panel title="Records so far">
            <PanelRows
              rows={[
                ['Solana transaction', m.solanaSignature ? <a href={solscan(m.solanaSignature)} target="_blank" rel="noreferrer">{short(m.solanaSignature, 4, 4)}</a> : 'not yet'],
                ['Quote', `${short(quoteHash(m.quote), 4, 4)} · signed`],
                ['Deposit address', short(m.depositAddress, 4, 4)],
                ['Zcash transaction', m.zcashTxid ? <a href={zcashTx(m.zcashTxid)} target="_blank" rel="noreferrer">{short(m.zcashTxid, 4, 4)}</a> : 'not yet'],
              ]}
            />
          </Panel>
          {failed ? (
            <Panel title="What not to do">
              <Bullets tone="warn" items={['Don’t send to the same deposit address again', 'Don’t share your recovery phrase with anyone offering help']} />
            </Panel>
          ) : slow ? (
            <Panel title="If you need help">
              <p className="sub">
                Moves can be held for review by NEAR Intents; ZecDoor can’t speed them up or see inside them. Their support needs the deposit address and the
                quote, which “Copy transfer details” copies.
              </p>
              <Bullets
                items={[
                  'You can close this page; it picks up again on this device',
                  'Don’t send the same amount again: this move isn’t lost',
                  <a key="s" href={NEAR_SUPPORT_URL} target="_blank" rel="noreferrer">
                    NEAR Intents support
                  </a>,
                ]}
              />
            </Panel>
          ) : (
            <Panel title="Expected">
              <PanelRows
                rows={[
                  ['Arrives, at least', zec(BigInt(m.minAmountOut), 0)],
                  ['Usually done by', '3–9 min'],
                  ['If it can’t complete', `refund to ${short(m.owner, 4, 3)}`],
                ]}
              />
            </Panel>
          )}
          <RecentPanel moves={moves} owner={m.owner} exclude={m.depositAddress} />
        </>
      }
      wide
    >
      <div className="bar">
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Moving {sent(m)}</h1>
        <span className="badge" style={{ color: slow ? 'var(--warn)' : 'var(--info)' }}>
          {slow ? 'Slower than usual' : 'In progress'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="amount lg">{clock(now - m.createdAt)}</span>
        <span className="muted" style={{ fontSize: 15 }}>
          elapsed · usually 3–9 minutes
        </span>
      </div>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.title} className={s.s} aria-current={s.s === 'active' || s.s === 'stuck' ? 'step' : undefined}>
            <span className="rail">
              <span className="mark">{s.s === 'done' ? '✓' : steps.indexOf(s) + 1}</span>
              <span className="line" />
            </span>
            <span className="text">
              <b>{s.title}</b>
              <span>{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      {stale ? (
        <StateCard tone="info" title="Can’t reach NEAR Intents right now">
          Showing the last status we read. We keep trying; your move is not affected.
        </StateCard>
      ) : null}
      {slow && m.status === 'PENDING_DEPOSIT' ? (
        <StateCard tone="warn" title="Deposit not seen yet" tag="After signing" action="Look on Solscan" onAction={() => m.solanaSignature && window.open(solscan(m.solanaSignature), '_blank', 'noopener')}>
          NEAR Intents has not seen your Solana transaction. If it failed on Solana, nothing left your wallet and this quote simply expires. If it went
          through, the move continues or is refunded.
        </StateCard>
      ) : null}
      {slow && converting ? (
        <StateCard tone="info" title="Taking longer than usual" tag="After signing" action="Copy transfer details" onAction={() => void copyDetails(m)}>
          Still converting after {duration(now - m.statusSince)}. This happens when the bridge is busy, and NEAR Intents can also hold transfers for
          review. Your ZEC will either arrive or be refunded to your Solana wallet. If it lasts, contact NEAR Intents at {NEAR_SUPPORT_URL.replace('https://', '')} with the transfer details.
        </StateCard>
      ) : null}
      {m.status === 'INCOMPLETE_DEPOSIT' ? (
        <StateCard tone="warn" title="Deposit was short" tag="After signing">
          NEAR Intents received less than the quote. It will be refunded to your Solana wallet after the quote’s deadline.
        </StateCard>
      ) : null}
      {m.status === 'FAILED' ? (
        <StateCard tone="err" title="Failed" tag="After signing" action="Copy transfer details" onAction={() => void copyDetails(m)}>
          NEAR Intents reports this move failed. Contact them at {NEAR_SUPPORT_URL.replace('https://', '')} with the transfer details.
        </StateCard>
      ) : null}

      <div className="note">
        You can close this page. When you come back on this device, we pick up where we left off. Our server keeps nothing about this move beyond
        running totals of all moves and a 24-hour duplicate check.
      </div>
    </Shell>
  );
}

async function copyDetails(m: MoveRecord) {
  const text = [
    `Deposit address: ${m.depositAddress}`,
    m.solanaSignature ? `Solana transaction: ${m.solanaSignature}` : '',
    `Quote timestamp: ${m.quote.timestamp}`,
    `Quote signature: ${m.quote.signature}`,
    m.quote.correlationId ? `Correlation ID: ${m.quote.correlationId}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await navigator.clipboard.writeText(text).catch(() => {});
}

function Proof({ m }: { m: MoveRecord }) {
  const { moves } = useApp();
  const [copied, setCopied] = useState(false);
  const sigOk = verifyQuoteSignature(m.quote, QUOTE_KEY);
  const value = m.arrival ? BigInt(m.arrival.value) : BigInt(m.amountOut);
  const took = m.completedAt ? duration(m.completedAt - m.createdAt) : null;
  const viewed = !!m.arrival;

  const copy = async () => {
    const text = [
      `ZecDoor move ${new Date(m.createdAt).toISOString()}`,
      `Quote hash: ${quoteHash(m.quote)}`,
      `Quote signature (NEAR Intents): ${m.quote.signature}`,
      m.solanaSignature ? `Solana transaction: ${m.solanaSignature}` : '',
      m.zcashTxid ? `Zcash transaction: ${m.zcashTxid}${m.arrival ? ` (block ${m.arrival.height})` : ''}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
  };

  return (
    <Shell
      rail={
        <>
          <RoutePanel kind={m.kind} owner={m.owner} dest={viewed ? 'Found by your browser' : 'Paid to your address'} title="The route, done" cap={took ?? undefined} states={['done', 'done', 'ok']} />
          <Panel title="What this proves">
            <p className="sub">Each line can be checked by anyone: the quote against NEAR Intents’ public key, the two transactions on their chains.</p>
            <p className="sub">
              {viewed
                ? 'The last line was checked by this browser alone, with a viewing key that can see but not spend.'
                : 'This page did not make the receiving wallet, so it cannot look inside it. Your wallet app shows the note.'}
            </p>
          </Panel>
          <Panel title="Sharing the proof">
            <p className="sub">
              “Copy proof” copies the quote and the two transaction IDs. Anyone you share it with can look up your Solana wallet and, on NEAR Intents’ explorer,
              the Zcash address it paid.
            </p>
          </Panel>
          <RecentPanel moves={moves} owner={m.owner} exclude={m.depositAddress} />
        </>
      }
      wide
    >
      <div className="bar">
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Arrived</h1>
        <span className="badge" style={{ color: 'var(--ok)' }}>
          {viewed ? `Arrived${took ? ` · ${took}` : ''}` : 'Sent on Zcash'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="amount lg">{zec(value, 0)}</span>
        <span className="muted" style={{ fontSize: 15 }}>
          {viewed ? `in your shielded wallet, in the ${m.arrival!.pool === 'ironwood' ? 'Ironwood' : 'Orchard'} pool` : 'paid to your shielded address by NEAR Intents'}
        </span>
      </div>

      <div className="checks">
        <div>
          {sigOk ? <CheckCircle /> : <CheckCircle color="var(--err)" />}
          <span className="body">
            <b>Quote signed by NEAR Intents</b>
            <span>{sigOk ? 'Signature valid. It names your address and the minimum amount.' : 'The saved quote no longer verifies.'}</span>
            <span className="id">quote {short(quoteHash(m.quote), 4, 4)}</span>
          </span>
        </div>
        <div>
          <CheckCircle />
          <span className="body">
            <b>Solana transaction</b>
            <span>Your {sent(m)} left your Solana wallet.</span>
            {m.solanaSignature ? (
              <a className="id" href={solscan(m.solanaSignature)} target="_blank" rel="noreferrer">
                {short(m.solanaSignature, 4, 4)}
              </a>
            ) : null}
          </span>
        </div>
        <div>
          {m.zcashTxid ? <CheckCircle /> : <Pending />}
          <span className="body">
            <b>Zcash transaction</b>
            <span>Paid by the bridge into the shielded pool.</span>
            {m.zcashTxid ? (
              <a className="id" href={zcashTx(m.zcashTxid)} target="_blank" rel="noreferrer">
                {short(m.zcashTxid, 4, 4)}
                {m.arrival ? ` · block ${height(m.arrival.height)}` : ''}
              </a>
            ) : null}
          </span>
        </div>
        <div>
          {viewed ? <CheckCircle /> : <Pending />}
          <span className="body">
            <b>{viewed ? 'Note found by your browser' : 'Check it in your wallet'}</b>
            <span>
              {viewed
                ? 'Trial-decrypted with your viewing key. Amount at or above the quote.'
                : 'Open the wallet you pasted the address from. It shows the payment once it syncs.'}
            </span>
            {viewed ? <span className="id">{m.arrival!.pool === 'ironwood' ? 'Ironwood' : 'Orchard'} · {zec(value, 0)}</span> : null}
          </span>
        </div>
      </div>
      {viewed ? (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          The last check ran in your browser with your viewing key. Nothing about your wallet was sent to our server.
        </p>
      ) : null}
      <button type="button" className="btn" onClick={() => go(`/after/${m.depositAddress}`)}>
        What to do next
      </button>
      <button type="button" className="btn ghost" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy proof (transaction IDs only)'}
      </button>
    </Shell>
  );
}

function Refund({ m }: { m: MoveRecord }) {
  const app = useApp();
  const back = m.refund?.amount ? BigInt(m.refund.amount) : BigInt(m.amountIn);
  const backLabel = m.kind === 'buyUsdc' ? usdc(back) : m.kind === 'buySol' ? sol(back) : zec(back);
  const t = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <Shell
      rail={
        <>
          <Panel title="What happened" full>
            <ol className="tl">
              <li>
                <span className="n ok">✓</span>
                <span>
                  <span className="h">Signed and sent from your wallet</span>
                  {m.solanaSignature ? <span className="d">Solana transaction {short(m.solanaSignature, 4, 4)}</span> : null}
                </span>
                <span className="r">{day(m.createdAt)} {t(m.createdAt)}</span>
              </li>
              <li>
                <span className="n fail">×</span>
                <span>
                  <span className="h">Not converted</span>
                  <span className="d">{refundReason(m.refund?.reason)}</span>
                </span>
                <span className="r" />
              </li>
              <li>
                <span className="n ok">✓</span>
                <span>
                  <span className="h">Refunded to {short(m.owner, 4, 3)}</span>
                  {m.refund?.txid ? <span className="d">Refund transaction {short(m.refund.txid, 4, 4)}</span> : null}
                </span>
                <span className="r">{t(m.updatedAt)}</span>
              </li>
            </ol>
          </Panel>
          <Panel title="Where the funds are">
            <p className="sub">Back in the Solana wallet that sent them. ZecDoor never held them at any point.</p>
          </Panel>
          <Panel title="What stays public">
            <p className="sub">Both Solana transactions, and on NEAR Intents’ explorer that this wallet asked to pay a Zcash address. No ZEC reached the shielded pool.</p>
          </Panel>
        </>
      }
      wide
    >
      <div className="bar">
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Refunded</h1>
        <span className="badge" style={{ color: 'var(--err)' }}>
          Not moved
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="amount lg">{backLabel}</span>
        <span className="muted" style={{ fontSize: 15 }}>
          is back in your wallet on Solana
        </span>
      </div>
      <Rows
        plain
        rows={[
          ['Why', refundReason(m.refund?.reason)],
          [
            'Refund transaction',
            m.refund?.txid ? (
              <a className="mono" href={solscan(m.refund.txid)} target="_blank" rel="noreferrer">
                {short(m.refund.txid, 4, 4)}
              </a>
            ) : (
              'Shown in Phantom'
            ),
          ],
          ['Fees kept by the bridge', m.refund?.fee ? (m.kind === 'buyUsdc' ? usdc(BigInt(m.refund.fee)) : m.kind === 'buySol' ? sol(BigInt(m.refund.fee)) : zec(BigInt(m.refund.fee), 0)) : '—'],
        ]}
      />
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        We never held these funds. The bridge returned them directly to the wallet that sent them.
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void app.refreshBalances();
          go('/');
        }}
      >
        Try again with a new quote
      </button>
    </Shell>
  );
}
