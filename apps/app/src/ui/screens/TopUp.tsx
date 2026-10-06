import { APP_FEE_BPS } from '@zecdoor/solana';
import { useEffect, useState } from 'react';
import { sol, usdc, zec } from '../../lib/format';
import { dryQuote, MoveError, planTopUp, type DryQuote, type TopUpPlan } from '../../lib/move';
import { solNeeded } from '../../lib/solana';
import { continueWith } from '../flow';
import { BackBar, Panel, Shell, Spinner, StateCard } from '../parts';
import { Bullets, networkFee, NetworkFeeLabel, RouteMap } from '../rail';
import { go } from '../router';
import { useApp } from '../state';

export function TopUp() {
  const app = useApp();
  const { owner, balances, minimum, wallet, draft, geo } = app;
  const [payWith, setPayWith] = useState<'sol' | 'usdc'>('sol');
  const [plan, setPlan] = useState<TopUpPlan | null>(null);
  const [dry, setDry] = useState<DryQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bal = balances?.zec ?? 0n;
  useEffect(() => {
    if (!owner || !balances) return;
    setPlan(null);
    setError(null);
    setDry(null);
    planTopUp(bal, owner, payWith)
      .then(async (p) => {
        setPlan(p);
        setDry(await dryQuote('topup', p.target, owner));
      })
      .catch((e) => setError(e instanceof MoveError ? e.message : 'Could not price the top-up. Try again.'));
  }, [owner, balances, bal, payWith]);

  if (geo?.topup === false) {
    return (
      <Shell>
        <BackBar title="Top up and shield" back="/" />
        <StateCard tone="err" title="Not available in your region">
          The top-up uses Jupiter, which is not offered where you are. Moves of balances above the bridge minimum still work.
        </StateCard>
      </Shell>
    );
  }

  const pay = plan ? (payWith === 'sol' ? sol(plan.maxPay) : usdc(plan.maxPay)) : '…';
  const solCost = solNeeded('topup', {
    ...(payWith === 'sol' && plan ? { swapLamports: plan.maxPay } : {}),
    hasZecAccount: balances?.hasZecAccount ?? true,
  });
  const notEnough =
    !!plan && !!balances && (balances.sol < solCost || (payWith === 'usdc' && balances.usdc < plan.maxPay));
  const fee = plan ? (plan.target * BigInt(APP_FEE_BPS.topup)) / 10_000n : 0n;

  const review = async () => {
    if (!plan || notEnough) return;
    await continueWith(
      {
        kind: 'topup',
        amount: plan.target,
        topUp: plan,
        pay: { symbol: payWith === 'sol' ? 'SOL' : 'USDC', amount: plan.maxPay },
        ...(draft?.dest ? { dest: draft.dest } : {}),
      },
      wallet,
      app.setDraft,
    );
  };

  return (
    <Shell
      rail={
        <>
          <Panel title="The route" cap="one transaction, two parts" full>
            <RouteMap
              stops={[
                { icon: 'swap', t: '1 · Swap on Solana', s: `Jupiter, exact output, into your own ZEC account`, pub: 'Public: the swap and its amounts' },
                { icon: 'wallet', t: '2 · Send', s: 'All of it to the deposit address', pub: 'Public: your transfer and its amount' },
                { icon: 'bridge', t: '3 · NEAR Intents', s: 'Pays your Zcash address', pub: 'Public: which address you paid' },
                { icon: 'lock', t: '4 · Shielded pool', s: 'Your wallet', prv: 'Private after arrival' },
              ]}
            />
          </Panel>
          <Panel title="What the transaction may do">
            <p className="sub">Checked against our allowlist before your wallet sees it, then simulated on Solana:</p>
            <Bullets
              tone="ok"
              items={[
                'One swap whose output is your own ZEC account',
                `Use at most the swap’s maximum input of your ${payWith === 'sol' ? 'SOL' : 'USDC'}`,
                'Send exactly the quoted ZEC to the deposit address',
              ]}
            />
            <p className="sub">Nothing else. No message to sign, no approval left behind.</p>
          </Panel>
          <Panel title="Why top up">
            <p className="sub">
              The bridge only moves {minimum ? zec(minimum) : 'about 0.00134 ZEC'} or more. Below that, bridged ZEC stays on Solana unless something adds to it.
            </p>
            <p className="sub">
              If it can’t complete, NEAR Intents refunds Solana ZEC, including what the swap bought, to the wallet that sent it. Not the {payWith === 'sol' ? 'SOL' : 'USDC'} you spent.
            </p>
          </Panel>
        </>
      }
    >
      <BackBar title="Top up and shield" back="/" />

      <div className="card tight">
        <div className="sum">
          <div>
            <span>Your ZEC on Solana</span>
            <span className="mono">{zec(bal, 0).replace(' ZEC', '')}</span>
          </div>
          <div>
            <span>Bridge minimum</span>
            <span className="mono">{minimum ? zec(minimum, 0).replace(' ZEC', '') : '…'}</span>
          </div>
        </div>
        {minimum ? (
          <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden', marginTop: 6 }} aria-hidden="true">
            <div style={{ width: `${Math.min(100, Number((bal * 100n) / minimum))}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
        ) : null}
      </div>

      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <legend className="label" style={{ marginBottom: 10 }}>
          Pay the difference with
        </legend>
        <div className="toggle">
          <button type="button" aria-pressed={payWith === 'sol'} onClick={() => setPayWith('sol')}>
            SOL
          </button>
          <button type="button" aria-pressed={payWith === 'usdc'} onClick={() => setPayWith('usdc')}>
            USDC
          </button>
        </div>
      </fieldset>

      {error ? (
        <StateCard tone="err" title="Top-up not available" action="Try again" onAction={() => setPayWith(payWith)}>
          {error}
        </StateCard>
      ) : !plan ? (
        <Spinner label="Pricing the top-up…" />
      ) : (
        <div className="card tight">
          <span style={{ fontSize: 15, fontWeight: 600 }}>Your one signature does both</span>
          <div style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5 }}>
            <span className="mono accent-text">1</span>
            <span>
              Swap up to <strong>{pay}</strong> into {zec(plan.need, 0)} on Jupiter (Metis)
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.5 }}>
            <span className="mono accent-text">2</span>
            <span>
              Send all <strong>{zec(plan.target, 0)}</strong> to the bridge for your shielded address
            </span>
          </div>
          <div className="rule" />
          <div className="sum">
            <div>
              <NetworkFeeLabel />
              <span className="mono">{dry ? networkFee(dry.resp.quote.withdrawFee) : '…'}</span>
            </div>
            <div>
              <span>Our fee ({APP_FEE_BPS.topup / 100}%)</span>
              <span className="mono">{zec(fee, 0)}</span>
            </div>
            <div>
              <span>Solana fees and deposits</span>
              <span className="mono">≈ {sol(solCost - (payWith === 'sol' ? plan.maxPay : 0n))}</span>
            </div>
            <div className="total">
              <span>Arrives shielded</span>
              <span className="mono">{dry ? `≥ ${zec(BigInt(dry.resp.quote.minAmountOut), 0)}` : '…'}</span>
            </div>
          </div>
        </div>
      )}

      {notEnough ? (
        <StateCard tone="warn" title={payWith === 'usdc' && balances!.usdc < plan!.maxPay ? 'Not enough USDC' : 'Not enough SOL for fees'} tag="Before signing" action="Check again" onAction={() => void app.refreshBalances()}>
          {payWith === 'usdc' && balances!.usdc < plan!.maxPay
            ? `You need ${usdc(plan!.maxPay)} for the swap. Pay with SOL instead, or add USDC in your wallet.`
            : `You need about ${sol(solCost)} for the swap, Solana fees and the token accounts this transaction opens. Add SOL in your wallet, then come back.`}
        </StateCard>
      ) : null}

      <div className="note">
        Your wallet will show a swap and a transfer in the same transaction. That is expected. If anything fails, the whole transaction fails and
        nothing moves.
      </div>
      <button type="button" className="btn" disabled={!plan || notEnough} onClick={() => void review()}>
        Review
      </button>
      <button type="button" className="textlink" onClick={() => go('/')}>
        Rather wait? Payouts may bring you over the minimum later.
      </button>
    </Shell>
  );
}
