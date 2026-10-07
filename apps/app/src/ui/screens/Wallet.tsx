// Wallet creation with a forced backup check. The 24 words exist only in memory while these
// two screens are open; only the viewing key is saved. No copy button, on purpose.

import { wordlist } from '@scure/bip39/wordlists/english.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { height } from '../../lib/format';
import { putWallet } from '../../lib/store';
import { createWallet, freshAddress } from '../../lib/zcash';
import { BackBar, Shell, Spinner, StateCard } from '../parts';
import { go } from '../router';
import { useApp } from '../state';

export function WalletCreate() {
  const { seed } = useApp();
  const [shown, setShown] = useState(false);
  const [wrote, setWrote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);

  const started = useRef(false);
  useEffect(() => {
    // Exactly one seed per visit: the words must never change after they are shown.
    if (seed.current || started.current) return;
    started.current = true;
    createWallet()
      .then((w) => {
        seed.current = w;
        force((n) => n + 1);
      })
      .catch(() => setError('Could not reach the Zcash network to date your wallet. Check your connection and try again.'));
  }, [seed]);

  const words = seed.current?.mnemonic.split(' ') ?? [];
  const leave = () => {
    seed.current = null;
    go('/destination');
  };

  return (
    <Shell plain>
      <BackBar title="Your new shielded wallet" step="1 of 2" back={leave} />
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55 }} className="muted">
        These 24 words are the wallet. Write them on paper, in order. Anyone with them can spend your ZEC; without them, nobody can recover it —
        including us.
      </p>

      {error ? (
        <StateCard tone="err" title="Wallet not created" action="Try again" onAction={() => location.reload()}>
          {error}
        </StateCard>
      ) : !seed.current ? (
        <Spinner label="Making your wallet in this browser…" />
      ) : (
        <>
          <div className="card" style={{ position: 'relative', padding: 16 }}>
            <ol className={`words${shown ? '' : ' blurred'}`} aria-hidden={!shown}>
              {words.map((w, i) => (
                <li key={i}>
                  <span>{i + 1}</span>
                  {shown ? w : '•••••'}
                </li>
              ))}
            </ol>
            {shown ? null : (
              <div className="reveal">
                <button type="button" onClick={() => setShown(true)}>
                  Tap to show — make sure nobody is watching
                </button>
              </div>
            )}
          </div>

          <div className="note" style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '14px 16px' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Wallet Birthday Height</span>
              <span className="mono" style={{ fontSize: 16, color: 'var(--text)' }}>
                {height(seed.current.birthday)}
              </span>
            </span>
            <span style={{ maxWidth: '55%', lineHeight: 1.45, fontSize: 13 }}>
              Write this down too. Zodl asks for it; in Zkool, type it in — left blank, Zkool starts from today and misses this ZEC.
            </span>
          </div>

          <div className="note warn">
            <strong>No copy button, on purpose.</strong>
            <span>Clipboards and screenshots leak. Paper is safer. This page will never show these words again.</span>
          </div>

          <label className="check">
            <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} disabled={!shown} />I wrote all 24 words and the
            block number on paper
          </label>

          <button type="button" className="btn" disabled={!wrote} onClick={() => go('/wallet/check')}>
            Check my backup
          </button>
        </>
      )}
    </Shell>
  );
}

/**
 * Three positions, each with the right word and two decoys from the BIP-39 English list that
 * are not in this phrase (so the check never shows more of the phrase than it asks for).
 */
function makeQuiz(words: string[]): Array<{ n: number; right: string; opts: string[] }> {
  const rnd = (k: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % k;
  const picks = new Set<number>();
  while (picks.size < 3) picks.add(rnd(words.length));
  const inPhrase = new Set(words);
  return [...picks]
    .sort((a, b) => a - b)
    .map((i) => {
      const right = words[i]!;
      const decoys = new Set<string>();
      while (decoys.size < 2) {
        const w = wordlist[rnd(wordlist.length)]!;
        if (!inPhrase.has(w)) decoys.add(w);
      }
      const opts = [right, ...decoys];
      for (let k = opts.length - 1; k > 0; k--) {
        const j = rnd(k + 1);
        [opts[k], opts[j]] = [opts[j]!, opts[k]!];
      }
      return { n: i + 1, right, opts };
    });
}

export function WalletVerify() {
  const app = useApp();
  const { seed, draft } = app;
  const words = seed.current?.mnemonic.split(' ');
  const quiz = useMemo(() => (words ? makeQuiz(words) : []), [seed.current]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!seed.current) go('/wallet/new', true);
  }, [seed]);

  const done = quiz.length === 3 && quiz.every((q) => picks[q.n] === q.right);

  const finish = async () => {
    const s = seed.current;
    if (!done || !s) return;
    setSaving(true);
    await putWallet({ ufvk: s.ufvk, birthday: s.birthday, nextIndex: 0, createdAt: Date.now(), firstMovePending: true });
    const address = await freshAddress(s.ufvk, 0);
    seed.current = null; // the words leave memory here
    await app.reloadWallet();
    if (draft?.amount) {
      app.setDraft({ ...draft, dest: { kind: 'browser', address, index: 0 } });
      go('/review', true);
    } else go('/', true);
  };

  return (
    <Shell plain>
      <BackBar title="Check your backup" step="2 of 2" back="/wallet/new" />
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55 }} className="muted">
        Pick the right word from your paper. Three checks, then you're ready.
      </p>
      {quiz.map((q) => (
        <fieldset key={q.n} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>Word #{q.n}</legend>
          <div className="picks">
            {q.opts.map((w) => {
              const picked = picks[q.n] === w;
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={picked}
                  className={picked ? (w === q.right ? 'right' : 'wrong') : ''}
                  onClick={() => setPicks({ ...picks, [q.n]: w })}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {done ? (
        <div className="note ok" role="status">
          Backup checked. Your wallet is ready to receive.
        </div>
      ) : null}
      <button type="button" className="btn" disabled={!done || saving} onClick={() => void finish()}>
        Continue to review
      </button>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }} className="muted">
        Only a viewing key stays in this browser, to confirm the arrival. The 24 words are not stored.
      </p>
    </Shell>
  );
}
