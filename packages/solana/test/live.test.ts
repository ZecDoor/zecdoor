// Live, read-only checks against mainnet (NETWORK_TESTS=1). Nothing is signed or sent:
// quotes are dry, and each move is simulated with `sigVerify: false` from wallets that hold
// the right balances on 5 Oct 2026, paying a throwaway deposit address.

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { APP_FEE_BPS, ASSET, FEE_RECIPIENT, MIN_SOLANA_ZEC_ZAT, minimumWithFee } from '../src/constants.js';
import { feeSelfTest } from '../src/fees.js';
import { prepareMove } from '../src/move.js';
import { checkQuote, makeQuoteRequest, minimumFromError, OneClickClient, type MoveKind, type QuoteResponse } from '../src/oneclick.js';
import { simulateMove } from '../src/simulate.js';

const live = process.env.NETWORK_TESTS === '1';
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
// Orchard-only receiver of the project's own test wallet; our own refund wallet.
const TEST_UA = 'u1c5zssk2r6nasyar5amt5pw3szaes8h5wmer3qsaqkc2j6kjcae2lu95ycle3r8vvcdvpyfm7pdnx7624ckp7h5uwfa72l8y54cf4gu8m';
const OUR_WALLET = '3QFJWVEk6tpf52gtk3saAP1nkuci6GRMNHx72etsi67T';

// Public mainnet holders used only as simulation sources.
const SOURCES: Record<MoveKind, { owner: string; amount: bigint }> = {
  exit: { owner: 'HbC6R4UQQVBzhFr5QSnsriL58yaH9wf6qwNZH9hXJhQ1', amount: 133_669n }, // holds 163,124 zat
  topup: { owner: '3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5', amount: 133_669n }, // holds 37,814 zat of dust
  buyUsdc: { owner: '3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5', amount: 5_000_000n }, // 5 USDC
  buySol: { owner: '53qGPTAHghBgj2jj9GngtXE4n5YBSsvgXmR69g5UN8We', amount: 50_000_000n }, // 0.05 SOL
};

describe.skipIf(!live)('live 1Click', () => {
  const client = new OneClickClient();

  it('a fresh dry quote is signed by 1Click and passes our checks', async () => {
    const min = minimumWithFee(MIN_SOLANA_ZEC_ZAT, APP_FEE_BPS.exit);
    const sent = makeQuoteRequest({ kind: 'exit', amount: min, recipient: TEST_UA, refundTo: OUR_WALLET, dry: true });
    const r = await client.quote(sent);
    expect(() => checkQuote(r, sent)).not.toThrow();
    expect(r.quoteRequest.originAsset).toBe(ASSET.solanaZec);
  });

  it('a too-small exit is refused with the fee-adjusted minimum', async () => {
    const min = minimumWithFee(MIN_SOLANA_ZEC_ZAT, APP_FEE_BPS.exit);
    const sent = makeQuoteRequest({ kind: 'exit', amount: 120_000n, recipient: TEST_UA, refundTo: OUR_WALLET, dry: true });
    const e = await client.quote(sent).catch((x: unknown) => x);
    expect(minimumFromError(e)).toBe(min);
  });

  it('fee rows match what ZecDoor discloses (start-up self-test)', async () => {
    const report = await feeSelfTest({ recipient: TEST_UA, refundTo: OUR_WALLET });
    console.log(JSON.stringify(report.map(({ kind, ok, ours, total }) => ({ kind, ok, ours, total }))));
    for (const r of report) {
      expect(r.error).toBeUndefined();
      expect(r.rows.some((f) => f.recipient === FEE_RECIPIENT)).toBe(true);
      expect(r.ok).toBe(true);
    }
  });
});

describe.skipIf(!live)('live simulations', () => {
  const connection = new Connection(RPC, 'confirmed');

  for (const kind of Object.keys(SOURCES) as MoveKind[]) {
    it(`${kind}: allowlisted, fits, and the deposit address receives exactly the quoted amount`, async () => {
      const { owner, amount } = SOURCES[kind];
      const depositAddress = Keypair.generate().publicKey.toBase58();
      // Only depositAddress and amountIn are read when building; the quote checks are tested above.
      const quote = { quote: { depositAddress, amountIn: amount.toString() } } as unknown as QuoteResponse;
      const prepared = await prepareMove({ connection, kind, owner: new PublicKey(owner), quote });
      const sim = await simulateMove(connection, prepared.tx, prepared.allowlist);
      console.log(kind, { bytes: sim.bytes, units: sim.unitsConsumed, receives: sim.depositReceives.toString(), sol: prepared.swap?.inAmount });
      if (!sim.ok) console.log(sim.err, sim.logs.slice(-8));
      expect(sim.ok).toBe(true);
      expect(sim.depositReceives).toBe(amount);
    }, 60_000);
  }

  it('topup paid with USDC: allowlisted and the deposit receives exactly the quoted amount', async () => {
    const { owner, amount } = SOURCES.topup;
    const quote = { quote: { depositAddress: Keypair.generate().publicKey.toBase58(), amountIn: amount.toString() } } as unknown as QuoteResponse;
    const prepared = await prepareMove({ connection, kind: 'topup', owner: new PublicKey(owner), quote, topUpWith: 'usdc' });
    const sim = await simulateMove(connection, prepared.tx, prepared.allowlist);
    console.log('topup/usdc', { bytes: sim.bytes, units: sim.unitsConsumed, usdc: prepared.swap?.inAmount });
    if (!sim.ok) console.log(sim.err, sim.logs.slice(-8));
    expect(sim.ok).toBe(true);
    expect(sim.depositReceives).toBe(amount);
  }, 60_000);
});
