// Jupiter (Metis) swap API, used only to top up a balance that is below the bridge minimum.
// Keyless lite API: https://lite-api.jup.ag/swap/v1 (rate-limited; research p1-legal §A.3).

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { JUPITER_API, ZEC_MINT } from './constants.js';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label?: string } }>;
  [k: string]: unknown;
}

interface RawIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
}

export interface JupiterSwap {
  quote: JupiterQuote;
  setup: TransactionInstruction[];
  swap: TransactionInstruction;
  cleanup: TransactionInstruction[];
  lookupTables: string[];
}

const toIx = (ix: RawIx) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });

export class JupiterClient {
  constructor(
    private readonly base = JUPITER_API,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** Exact-output quote: buy exactly `outAmount` base units of Solana ZEC with `inputMint`. */
  async quoteExactOut(o: { inputMint: PublicKey; outAmount: bigint; slippageBps?: number; maxAccounts?: number }): Promise<JupiterQuote> {
    const u = new URL(this.base + '/quote');
    u.searchParams.set('inputMint', o.inputMint.toBase58());
    u.searchParams.set('outputMint', ZEC_MINT.toBase58());
    u.searchParams.set('amount', o.outAmount.toString());
    u.searchParams.set('swapMode', 'ExactOut');
    u.searchParams.set('slippageBps', String(o.slippageBps ?? 100));
    // Keeps the composed transaction well under Phantom's size budget (research p1-wallet §B2).
    u.searchParams.set('maxAccounts', String(o.maxAccounts ?? 24));
    const res = await this.fetchImpl(u.toString());
    const j = (await res.json()) as JupiterQuote & { error?: string };
    if (!res.ok || j.error || !j.inAmount) throw new Error(`Jupiter quote failed: ${j.error ?? res.status}`);
    return j;
  }

  async swapInstructions(quote: JupiterQuote, owner: PublicKey): Promise<JupiterSwap> {
    const res = await this.fetchImpl(this.base + '/swap-instructions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: owner.toBase58(), wrapAndUnwrapSol: true }),
    });
    const j = (await res.json()) as {
      error?: string;
      setupInstructions?: RawIx[];
      swapInstruction: RawIx;
      cleanupInstruction?: RawIx | null;
      addressLookupTableAddresses?: string[];
    };
    if (!res.ok || j.error) throw new Error(`Jupiter swap-instructions failed: ${j.error ?? res.status}`);
    return {
      quote,
      setup: (j.setupInstructions ?? []).map(toIx),
      swap: toIx(j.swapInstruction),
      cleanup: j.cleanupInstruction ? [toIx(j.cleanupInstruction)] : [],
      lookupTables: j.addressLookupTableAddresses ?? [],
    };
  }
}
