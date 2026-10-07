import { useEffect, useState, type ReactNode } from 'react';
import { height, short, zec } from '../../lib/format';
import { B1, checkQuote, checkSolana, checkZcash, type QuoteCheck, type SolanaCheck } from '../../lib/proof';
import { CheckCircle, Pending, Shell, StateCard } from '../parts';
import { solanaTx, zcashTx } from './Move';

type Live<T> = { state: 'checking' } | { state: 'done'; value: T } | { state: 'failed'; message: string };

function useLive<T>(run: () => Promise<T>, round: number): Live<T> {
  const [v, set] = useState<Live<T>>({ state: 'checking' });
  useEffect(() => {
    let on = true;
    set({ state: 'checking' });
    run().then(
      (value) => on && set({ state: 'done', value }),
      (e: unknown) => on && set({ state: 'failed', message: (e as Error).message || 'No answer.' }),
    );
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  return v;
}

const Fail = () => <CheckCircle color="var(--err)" />;

/**
 * Our first mainnet move, proved again in the visitor's browser: three checks run live against NEAR
 * Intents, a public Solana RPC and lightwalletd; the fourth is the recorded result. Nothing to connect.
 */
export function Proof() {
  const [round, setRound] = useState(0);
  const quote = useLive<QuoteCheck>(() => checkQuote(), round);
  const solana = useLive<SolanaCheck>(() => checkSolana(), round);
  const zcash = useLive<number | null>(() => checkZcash(), round);

  const q = quote.state === 'done' ? quote.value : null;
  const s = solana.state === 'done' ? solana.value : null;
  const quoteOk = !!q && q.signatureValid && q.matches && q.status === 'SUCCESS';
  const solanaOk = !!s && s.succeeded && s.deposited === B1.sent;
  const zTxOk = !!q && q.zcashTxid === B1.zcashTxid;
  const zcashOk = zTxOk && zcash.state === 'done' && zcash.value === B1.zcashHeight;
  const anyFailed = [quote, solana, zcash].some((x) => x.state === 'failed');

  return (
    <Shell plain
      wide>
      <div className="bar">
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Proof: our first mainnet move</h1>
        <span className="caption">{B1.date}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="amount lg">{zec(B1.found, 0)}</span>
        <span className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
          arrived shielded, {B1.elapsed} after signing. The wallet started with {zec(B1.startedWith, 0)}, below the bridge minimum; one transaction swapped in
          SOL and sent all {zec(B1.sent, 0)}.
        </span>
      </div>

      <div className="note" style={{ fontSize: 14 }}>
        Signed by our test key, standing in for Phantom, through the app’s own code. Moves signed in Phantom are recorded on the testing page as they
        happen.
      </div>

      {anyFailed ? (
        <StateCard tone="warn" title="A source did not answer" action="Check again" onAction={() => setRound((r) => r + 1)}>
          The checks run against public services from your browser. One of them did not answer; this says nothing about the move itself.
        </StateCard>
      ) : null}

      <div className="checks" aria-live="polite">
        <Check
          icon={quote.state === 'checking' ? <Pending /> : quoteOk ? <CheckCircle /> : <Fail />}
          title="Quote signed by NEAR Intents · live"
          body={
            quote.state === 'checking'
              ? 'Asking NEAR Intents for its record of this move…'
              : quote.state === 'failed'
                ? `NEAR Intents did not answer: ${quote.message}`
                : quoteOk
                  ? `Status ${q!.status}. Its signature on the quote is valid: ${zec(q!.amountIn, 0)} in, at least ${zec(q!.minAmountOut, 0)} out, to ${short(q!.recipient, 6, 6)}.`
                  : `Status ${q!.status}; signature ${q!.signatureValid ? 'valid' : 'not valid'}; ${q!.matches ? 'deposit matches' : 'deposit does not match'}.`
          }
          id={<span className="id">deposit {short(B1.depositAddress, 4, 4)}</span>}
        />
        <Check
          icon={solana.state === 'checking' ? <Pending /> : solanaOk ? <CheckCircle /> : <Fail />}
          title="Solana transaction · live"
          body={
            solana.state === 'checking'
              ? 'Reading the transaction from a public Solana RPC…'
              : solana.state === 'failed'
                ? solana.message
                : solanaOk
                  ? `Succeeded${s!.blockTime ? ` on ${new Date(s!.blockTime * 1000).toUTCString().slice(5, 22)} UTC` : ''}. The deposit address received ${zec(s!.deposited, 0)}, as quoted.`
                  : `${s!.succeeded ? 'Succeeded' : 'Failed'}; the deposit address received ${zec(s!.deposited, 0)}.`
          }
          id={
            <a className="id" href={solanaTx(B1.solanaSignature)} target="_blank" rel="noreferrer">
              {short(B1.solanaSignature, 6, 6)} · Solana Explorer
            </a>
          }
        />
        <Check
          icon={zcash.state === 'checking' || quote.state === 'checking' ? <Pending /> : zcashOk ? <CheckCircle /> : <Fail />}
          title="Zcash transaction · live"
          body={
            zcash.state === 'checking'
              ? 'Looking the transaction up on lightwalletd…'
              : zcash.state === 'failed'
                ? `lightwalletd did not answer: ${zcash.message}`
                : zcashOk
                  ? `NEAR Intents reports this payout, and lightwalletd has it in block ${height(zcash.value!)}. Amount and recipient inside are encrypted.`
                  : zcash.value === null
                    ? 'lightwalletd does not know this transaction.'
                    : `Found in block ${height(zcash.value)}${zTxOk ? '' : '; NEAR Intents reports a different transaction'}.`
          }
          id={
            <a className="id" href={zcashTx(B1.zcashTxid)} target="_blank" rel="noreferrer">
              {short(B1.zcashTxid, 6, 6)} · Zcash Block Explorer
            </a>
          }
        />
        <Check
          icon={<CheckCircle />}
          title="Note found with the viewing key · recorded"
          body={`On ${B1.date} the ZecDoor page found ${zec(B1.found, 0)} at the quoted address with the wallet’s viewing key, at or above the quote’s minimum. On 6 Oct, restoring the 24 words from birthday ${height(B1.birthday)} in zcash-devtool, built on the same Rust wallet libraries as Zodl’s wallets, showed the same ${zec(B1.found, 0)}.`}
          id={<span className="id">Ironwood pool · {zec(B1.found, 0)}</span>}
        />
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        The first three checks ran in your browser just now, against NEAR Intents, a public Solana RPC and lightwalletd. The explorer links open other
        sites, which see your IP address.
      </p>
      <button type="button" className="btn ghost" onClick={() => setRound((r) => r + 1)}>
        Check again
      </button>
    </Shell>
  );
}

function Check({ icon, title, body, id }: { icon: ReactNode; title: string; body: string; id: ReactNode }) {
  return (
    <div>
      {icon}
      <span className="body">
        <b>{title}</b>
        <span>{body}</span>
        {id}
      </span>
    </div>
  );
}
