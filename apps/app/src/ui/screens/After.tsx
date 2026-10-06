import { useEffect, useState } from 'react';
import { WALLET_APPS } from '../../config';
import { height, short, zec } from '../../lib/format';
import { quoteHash } from '@zecdoor/solana';
import { forgetWallet, getMove, type MoveRecord } from '../../lib/store';
import { BackBar, Panel, Shell } from '../parts';
import { CounterPanel, FaqPanel } from '../extras';
import { PanelRows, RecentPanel } from '../rail';
import { solscan, zcashTx } from './Move';
import { go } from '../router';
import { useApp } from '../state';

export function After({ id }: { id: string }) {
  const app = useApp();
  const { wallet } = app;
  const [m, setM] = useState<MoveRecord | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void getMove(id).then((r) => setM(r ?? null));
  }, [id]);

  const ours = m?.recipientIndex !== null && !!wallet;
  const amount = m ? (m.arrival ? BigInt(m.arrival.value) : BigInt(m.amountOut)) : null;

  const forget = async () => {
    await forgetWallet();
    await app.reloadWallet();
    go('/', true);
  };

  return (
    <Shell
      rail={
        <>
          {ours ? (
            <Panel title="This wallet">
              <PanelRows
                rows={[
                  ['Shielded, found by your browser', amount !== null ? zec(amount, 0) : '—'],
                  ['Wallet birthday height', height(wallet!.birthday)],
                  ['Next address', `#${wallet!.nextIndex + 1}`],
                ]}
              />
            </Panel>
          ) : null}
          {m ? (
            <Panel title="The proof">
              <PanelRows
                rows={[
                  ['Solana', m.solanaSignature ? <a href={solscan(m.solanaSignature)} target="_blank" rel="noreferrer">{short(m.solanaSignature, 4, 4)}</a> : '—'],
                  ['Zcash', m.zcashTxid ? <a href={zcashTx(m.zcashTxid)} target="_blank" rel="noreferrer">{short(m.zcashTxid, 4, 4)}</a> : '—'],
                  ['Quote', short(quoteHash(m.quote), 4, 4)],
                ]}
              />
            </Panel>
          ) : null}
          <Panel title="Why these steps">
            <p className="sub">
              Inside the shielded pool, amounts and addresses are encrypted. What can still link you is timing and exact amounts at the edges: when ZEC enters
              and when it leaves.
            </p>
          </Panel>
          <RecentPanel moves={app.moves} owner={m?.owner ?? null} />
          <FaqPanel />
        </>
      }
      left={<CounterPanel />}
    >
      <BackBar title="Your ZEC is home. Now:" back={`/move/${id}`} />

      <div className="card accent tight">
        <span className="kicker accent">1 · To spend it</span>
        {ours ? (
          <>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Open your wallet in Zodl or Zkool</span>
            <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
              Choose “Restore”, enter your 24 words, and enter Wallet Birthday Height{' '}
              <strong className="mono" style={{ color: 'var(--text)' }}>
                {height(wallet!.birthday)}
              </strong>{' '}
              as the birthday.
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 18, fontWeight: 600 }}>It is in the wallet you chose</span>
            <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
              Open that wallet and let it sync. The payment shows in its history.
            </span>
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <a className="btn sm" href={WALLET_APPS.zodl} target="_blank" rel="noreferrer">
            Get Zodl
          </a>
          <a className="btn sm ghost" style={{ minHeight: 48 }} href={WALLET_APPS.zkool} target="_blank" rel="noreferrer">
            Get Zkool
          </a>
        </div>
      </div>

      <div className="card plain tight">
        <span className="kicker">2 · To keep it private</span>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15, lineHeight: 1.5 }} className="muted">
          <li>Wait a while before you move it again. Moving it straight back links the two moves by time.</li>
          <li>Don't send exactly {amount !== null ? zec(amount, 0) : 'the amount that arrived'} out. Round amounts blend in.</li>
          <li>Pay other shielded addresses where you can.</li>
        </ul>
      </div>

      <div className="card plain tight">
        <span className="kicker">3 · To move more later</span>
        <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
          Come back any time. Each move goes to a new address of the same wallet. The bridge's explorer still links your Solana wallet to the addresses it
          paid; what you do after arrival stays private.
        </span>
      </div>

      {wallet ? (
        confirming ? (
          <div className="note err">
            <strong>Forget this wallet here?</strong>
            <span>Only do this once your 24 words are safe. Your ZEC stays in the shielded pool; the words still open it.</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button type="button" className="btn danger sm" style={{ minHeight: 48 }} onClick={() => void forget()}>
                Forget
              </button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
              Forget this wallet on this device
            </button>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              Removes the viewing key from this browser. Your ZEC stays safe in the shielded pool; your 24 words still open it.
            </p>
          </>
        )
      ) : null}
    </Shell>
  );
}
