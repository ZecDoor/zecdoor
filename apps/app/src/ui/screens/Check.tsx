import { useEffect, useState } from 'react';
import { APP_FEE_BPS } from '@zecdoor/solana';
import { Keypair, PublicKey } from '@solana/web3.js';
import { APP_URL, MOVES_OPEN } from '../../config';
import { estimate, short, sol, usd, zec } from '../../lib/format';
import { dryQuote, exitMinimum, type DryQuote } from '../../lib/move';
import { readBalances, solNeeded, type Balances } from '../../lib/solana';
import { movingCost } from '../../lib/economics';
import { feeOk, isSanctioned } from '../../lib/server';
import { Logo, Shell, StateCard, Tick } from '../parts';
import { networkFee, NetworkFeeLabel, PanelRows } from '../rail';
import { go } from '../router';
import { DeskTabs } from '../desk';
import { useWide } from '../rail';
import { useApp } from '../state';

/** A Solana address, or null. Only the shape is checked: any account can hold ZEC. */
export function parseOwner(s: string): PublicKey | null {
  const t = s.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return null;
  try {
    return new PublicKey(t);
  } catch {
    return null;
  }
}

/**
 * Quotes for the check are asked for with a throwaway refund address, not the address being
 * checked: the minimum and the amounts do not depend on it, and NEAR Intents never sees it.
 */
const probe = Keypair.generate().publicKey;

interface Result {
  bal: Balances;
  minimum: bigint;
  quote: DryQuote | null;
  sanctioned: boolean;
}

/**
 * Check any Solana address without connecting: the ZEC it holds on Solana, whether that clears the
 * bridge minimum, what ZecDoor would do and what it would cost. The address lives only in the link
 * after the "#", which browsers do not send to any server; nothing is stored.
 */
export function Check({ address }: { address?: string }) {
  const { prices, health, geo } = useApp();
  const owner = address ? parseOwner(address) : null;
  const [input, setInput] = useState(address ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setInput(address ?? ''), [address]);

  const key = owner?.toBase58() ?? null;
  useEffect(() => {
    setResult(null);
    setError(null);
    setCopied(false);
    if (!owner) return;
    let live = true;
    void (async () => {
      try {
        const [bal, minimum, sanctioned] = await Promise.all([readBalances(owner), exitMinimum(probe), isSanctioned(owner.toBase58())]);
        const quote = bal.zec >= minimum ? await dryQuote('exit', bal.zec, probe).catch(() => null) : null;
        if (live) setResult({ bal, minimum, quote, sanctioned });
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const o = parseOwner(input);
    if (o) go(`/check/${o.toBase58()}`, true);
  };
  const bad = input.trim() !== '' && !parseOwner(input);

  const link = key ? `${APP_URL}#/check/${key}` : null;
  const share = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Shell
      nav="check">
      <div className="bar ph">
        <a className="brand" href="#/" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Logo />
          ZecDoor
        </a>
      </div>

      <div className="dk">
        <DeskTabs at="check" />
      </div>
      <h1 className="ph" style={{ margin: 0, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.03em', fontWeight: 600 }}>Check any Solana wallet</h1>
      <p className="muted ph" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
        Paste a Solana address to see the ZEC it holds on Solana, and whether moving it to a shielded Zcash wallet is worth it. No wallet to connect.
      </p>

      <form className="field check-form" onSubmit={submit}>
        <label htmlFor="sol-addr" className="label">
          <span className="ph">Solana address</span>
          <span className="dk">Any Solana address, no wallet needed</span>
        </label>
        <input
          id="sol-addr"
          className={`input${bad ? ' bad' : ''}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a Solana address"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="sol-addr-check"
        />
        <span id="sol-addr-check" role="status" style={{ fontSize: 14 }} className={bad ? 'err' : 'muted'}>
          {bad ? 'That is not a Solana address.' : 'Read from public Solana data. Never stored.'}
        </span>
        <button type="submit" className={result ? 'btn ghost' : 'btn'} disabled={!parseOwner(input)}>
          Check
        </button>
      </form>

      {address && !owner ? (
        <StateCard tone="err" title="Not a Solana address">
          The link holds something that is not a Solana address. Paste the address above.
        </StateCard>
      ) : null}
      {error ? (
        <StateCard tone="warn" title="Can’t read this address" action="Try again" onAction={() => go(`/check/${key}`, true)}>
          {error}
        </StateCard>
      ) : null}
      {owner && !result && !error ? (
        <p className="muted" role="status" style={{ margin: 0, fontSize: 15 }}>
          Reading {short(owner.toBase58(), 4, 4)}…
        </p>
      ) : null}

      {owner && result ? (
        <Verdict
          owner={owner}
          r={result}
          prices={prices}
          paused={!!health?.paused || !feeOk(health, 'exit')}
          topupAllowed={geo?.topup !== false}
          share={share}
          copied={copied}
        />
      ) : null}
    </Shell>
  );
}

function Verdict({ owner, r, prices, paused, topupAllowed, share, copied }: {
  owner: PublicKey;
  r: Result;
  prices: { zec?: number; sol?: number };
  paused: boolean;
  topupAllowed: boolean;
  share: () => Promise<void>;
  copied: boolean;
}) {
  const wide = useWide();
  const { bal, minimum, quote } = r;
  const zat = bal.zec;
  const asUsd = (v: bigint) => (prices.zec ? usd(Math.max((Number(v) / 1e8) * prices.zec, 0.01)) : null);
  const cost = movingCost(minimum, prices);
  const none = zat === 0n;
  const ready = zat >= minimum;
  const dust = !none && !ready && !!cost && zat < cost.zat;
  const need = ready ? 0n : minimum - zat;
  const solFees = solNeeded(ready ? 'exit' : 'topup', { hasZecAccount: bal.hasZecAccount });
  const q = quote?.resp.quote;

  const head = none
    ? { tone: 'info' as const, title: 'No ZEC on Solana here', body: 'This address holds no bridged ZEC in its main token account. There is nothing to move.' }
    : ready
      ? { tone: 'ok' as const, title: 'Ready to move', body: `ZecDoor would move all ${zec(zat)} to a shielded Zcash address, in one signature.` }
      : dust
        ? {
            tone: 'warn' as const,
            title: 'Not worth moving',
            body: `Its ${zec(zat, 0)} is worth about ${asUsd(zat) ?? '—'}. One move costs about ${asUsd(cost!.zat) ?? zec(cost!.zat, 0)} in fixed fees, so moving it would cost more than it is worth. ZecDoor would still allow a top-up, but we don’t recommend it.`,
          }
        : {
            tone: 'info' as const,
            title: 'Below the minimum, worth moving',
            body: topupAllowed
              ? `ZecDoor would swap about ${asUsd(need) ?? zec(need, 0)} of SOL or USDC into ZEC and move all of it, in the same signature.`
              : 'Top-up is not offered where you are. A balance over the minimum can be moved.',
          };

  const rows: Array<[React.ReactNode, React.ReactNode]> = [
    // The desktop shows the address in the field right above the result.
    ...(wide ? [] : ([['Address', <span key="a" className="mono">{short(owner.toBase58(), 6, 6)}</span>]] as Array<[React.ReactNode, React.ReactNode]>)),
    ['ZEC on Solana', none ? '0' : `${zec(zat)}${asUsd(zat) ? ` · about ${asUsd(zat)}` : ''}`],
    ['Bridge minimum', zec(minimum)],
    ['Clears the minimum', none ? '—' : ready ? 'Yes' : `No, ${zec(need, 0)} short`],
  ];
  if (ready && q) {
    rows.push(
      ['Arrives shielded, at least', zec(BigInt(q.minAmountOut), 0)],
      [<NetworkFeeLabel key="f" />, networkFee(q.withdrawFee)],
      [`Our fee (${APP_FEE_BPS.exit / 100}%)`, zec((zat * BigInt(APP_FEE_BPS.exit)) / 10_000n, 0)],
      ['NEAR Intents estimates', estimate(q.timeEstimate) ?? '—'],
    );
  } else if (!none && !ready && cost) {
    rows.push(
      ['One move’s fixed cost', `about ${asUsd(cost.zat) ?? zec(cost.zat, 0)}`],
      ['Bridge payout fee', `up to ${zec(cost.payoutFee, 0)}`],
      [`Our fee (${APP_FEE_BPS.topup / 100}%) and the swap’s 1% limit`, zec(cost.ourFee + cost.slippage, 0)],
      ['Deposit account and Solana fee', `about ${asUsd(cost.solana) ?? zec(cost.solana, 0)}`],
    );
  }
  if (!none) {
    rows.push(['SOL for fees', `≈ ${sol(solFees)}${ready ? '' : ' plus the swap'} · ${bal.sol >= solFees ? 'has enough' : `has ${sol(bal.sol)}`}`]);
  }

  return (
    <>
      {r.sanctioned ? (
        <StateCard tone="err" title="ZecDoor does not serve this address">
          It is on the US sanctions list we check before every move.
        </StateCard>
      ) : (
        <StateCard tone={head.tone} title={head.title}>
          {head.body}
        </StateCard>
      )}

      <div className="card plain tight">
        <PanelRows rows={rows} />
        {ready && !q ? <p className="sub">NEAR Intents did not return a quote just now. The figures above are read live.</p> : null}
      </div>

      {paused ? (
        <StateCard tone="warn" title="The bridge is paused">
          NEAR Intents has paused transfers, so no move can start right now.
        </StateCard>
      ) : null}

      <div className="check-actions">
        {r.sanctioned ? null : none ? (
          <a className="btn" href="#/buy">
            Buy shielded ZEC with USDC or SOL
          </a>
        ) : (
          <a className={dust ? 'btn ghost' : 'btn'} href="#/">
            {dust ? 'Open ZecDoor anyway' : ready ? 'Move it with ZecDoor' : 'Top up and shield with ZecDoor'}
          </a>
        )}
        {!MOVES_OPEN && !r.sanctioned ? (
          <p className="muted ph" style={{ margin: 0, fontSize: 14 }}>
            Moves and buys open once our own mainnet test moves have passed. You can connect and see live quotes now.
          </p>
        ) : null}

        <button type="button" className="btn ghost" onClick={() => void share()}>
          {copied ? (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Tick size={16} /> Link copied
            </span>
          ) : (
            <>
              <span className="ph">Copy a link to this result</span>
              <span className="dk">Copy link</span>
            </>
          )}
        </button>
      </div>
      <p className="muted ph" style={{ margin: 0, fontSize: 13 }}>
        The link names this address, so anyone you send it to sees the same result. It is read fresh each time it opens.
      </p>
      <p className="dfine dk">
        {!MOVES_OPEN && !r.sanctioned ? 'Moves open soon; live quotes work now. ' : ''}The link names this address and is read fresh each time.
      </p>
    </>
  );
}
