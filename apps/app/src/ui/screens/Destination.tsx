import { useEffect, useState } from 'react';
import { wasAddressUsed } from '../../lib/store';
import { ADDRESS_PROBLEMS, inspect } from '../../lib/zcash';
import { continueWith } from '../flow';
import { BackBar, Shell, Tick } from '../parts';
import { go } from '../router';
import { useApp } from '../state';

export function Destination() {
  const app = useApp();
  const { draft, wallet } = app;
  const [own, setOwn] = useState(draft?.dest?.kind === 'own');
  const [addr, setAddr] = useState(draft?.dest?.kind === 'own' ? draft.dest.address : '');
  const [check, setCheck] = useState<{ ok: boolean; message: string; reused: boolean } | null>(null);

  useEffect(() => {
    const a = addr.trim();
    if (!a) return setCheck(null);
    let live = true;
    void (async () => {
      const r = await inspect(a);
      const reused = r.ok ? await wasAddressUsed(a) : false;
      if (live) setCheck({ ok: r.ok, message: r.ok ? 'Shielded address · can receive in Ironwood' : ADDRESS_PROBLEMS[r.reason], reused });
    })();
    return () => {
      live = false;
    };
  }, [addr]);

  const canGo = !own || !!check?.ok;
  const next = async () => {
    if (!canGo) return;
    // Without an amount yet (opened from Home's "Change"), remember the choice and go back.
    if (own) {
      const dest = { kind: 'own' as const, address: addr.trim(), index: null };
      if (!draft?.amount) {
        app.setDraft({ kind: 'exit', amount: 0n, dest });
        return go('/');
      }
      return continueWith({ ...draft, dest }, wallet, app.setDraft);
    }
    if (!draft?.amount) {
      app.setDraft(null);
      return go('/');
    }
    return continueWith({ ...draft, dest: undefined } as typeof draft, wallet, app.setDraft);
  };

  return (
    <Shell plain>
      <BackBar title="Where should it land?" back="/" />

      <button type="button" className="option" aria-pressed={!own} onClick={() => setOwn(false)}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span className="title">{wallet ? 'My wallet in this browser' : 'Create one here'}</span>
          <span className="tag">{wallet ? 'FRESH ADDRESS' : 'FIRST TIME'}</span>
        </span>
        <span className="body">
          {wallet
            ? 'The shielded wallet you made here. Each move goes to a new address of it; your 24 words open all of them in Zodl or Zkool.'
            : 'A shielded Zcash wallet made in this browser. You write down 24 words; later you open them in Zodl or Zkool to spend.'}
        </span>
      </button>

      <button type="button" className="option" aria-pressed={own} onClick={() => setOwn(true)}>
        <span className="title">Use my Zcash wallet</span>
        <span className="body">Paste a new receiving address from Zodl, Zkool or another shielded wallet.</span>
      </button>

      {own ? (
        <div className="field">
          <label htmlFor="ua" className="label">
            Zcash address
          </label>
          <input
            id="ua"
            className={`input${check ? (check.ok ? ' ok' : ' bad') : ''}`}
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="u1…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="ua-check"
          />
          <span id="ua-check" role="status" style={{ fontSize: 14, display: 'flex', gap: 8, alignItems: 'center' }} className={check ? (check.ok ? 'ok' : 'err') : 'muted'}>
            {check?.ok ? <Tick size={16} /> : null}
            {check?.message ?? 'Unified addresses (u1…) with a shielded receiver work.'}
          </span>
          {check?.ok && check.reused ? (
            <span className="warn" style={{ fontSize: 14 }}>
              You used this address before on this device. A new one from your wallet’s Receive screen keeps moves apart.
            </span>
          ) : null}
          <div className="note">
            The bridge's public explorer shows which Zcash address your Solana wallet paid. A new address each move keeps your addresses from
            piling up on one record — Zodl and Zkool show a new one on their Receive screen.
          </div>
        </div>
      ) : null}

      <button type="button" className="btn" style={{ marginTop: 8 }} disabled={!canGo} onClick={() => void next()}>
        Continue
      </button>
    </Shell>
  );
}
