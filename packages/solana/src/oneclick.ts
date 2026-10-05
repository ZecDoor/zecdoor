// NEAR Intents 1Click client: quote, status, deposit submit, and quote checks.
// API: https://1click.chaindefuser.com/docs/v0/openapi.yaml (spec 0.1.10).
// The browser calls it directly (CORS is open and no key is needed unauthenticated).

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { PublicKey } from '@solana/web3.js';
import { APP_FEE_BPS, ASSET, FEE_RECIPIENT, ONE_CLICK_API, ONE_CLICK_SIGNING_KEY } from './constants.js';
import { stableStringify } from './stable-json.js';

export type MoveKind = 'exit' | 'topup' | 'buyUsdc' | 'buySol';

export interface AppFee {
  recipient: string;
  fee: number;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'FLEX_INPUT' | 'ANY_INPUT';
  slippageTolerance: number;
  originAsset: string;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS';
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: 'ORIGIN_CHAIN' | 'INTENTS';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS';
  deadline: string;
  appFees?: AppFee[];
  quoteWaitingTimeMs?: number;
  referral?: string;
  [extra: string]: unknown;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId?: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type SwapStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'INCOMPLETE_DEPOSIT'
  | 'REFUNDED'
  | 'FAILED';

export interface StatusResponse {
  status: SwapStatus;
  updatedAt: string;
  correlationId?: string;
  quoteResponse?: QuoteResponse;
  swapDetails?: {
    amountIn?: string;
    amountOut?: string;
    depositedAmount?: string;
    refundedAmount?: string;
    refundReason?: string;
    refundFee?: string;
    withdrawFee?: string;
    originChainTxHashes?: Array<{ hash: string; explorerUrl: string }>;
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl: string }>;
    [k: string]: unknown;
  };
}

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const ORIGIN: Record<MoveKind, string> = {
  exit: ASSET.solanaZec,
  topup: ASSET.solanaZec,
  buyUsdc: ASSET.solanaUsdc,
  buySol: ASSET.sol,
};

/** The request ZecDoor sends for each kind of move. No referral tag (privacy, p1 §B4). */
export function makeQuoteRequest(o: {
  kind: MoveKind;
  amount: bigint;
  recipient: string;
  refundTo: string;
  dry: boolean;
  deadlineMinutes?: number;
  now?: number;
}): QuoteRequest {
  const now = o.now ?? Date.now();
  return {
    dry: o.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: ORIGIN[o.kind],
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: ASSET.zec,
    amount: o.amount.toString(),
    refundTo: o.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: o.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now + (o.deadlineMinutes ?? 30) * 60_000).toISOString(),
    appFees: [{ recipient: FEE_RECIPIENT, fee: APP_FEE_BPS[o.kind] }],
  };
}

// ---- signature (same construction as one-click-sdk-typescript 0.1.26 `quoteHash`) ----

function signedRequestFields(r: QuoteRequest): Record<string, unknown> {
  return {
    dry: r.dry,
    swapType: r.swapType,
    slippageTolerance: r.slippageTolerance,
    originAsset: r.originAsset,
    depositType: r.depositType,
    destinationAsset: r.destinationAsset,
    amount: r.amount,
    refundTo: r.refundTo,
    refundType: r.refundType,
    recipient: r.recipient,
    recipientType: r.recipientType,
    deadline: r.deadline,
    quoteWaitingTimeMs: r.quoteWaitingTimeMs || undefined,
    referral: r.referral || undefined,
    virtualChainRecipient: (r.virtualChainRecipient as string) || undefined,
    virtualChainRefundRecipient: (r.virtualChainRefundRecipient as string) || undefined,
    customRecipientMsg: (r.customRecipientMsg as string) || undefined,
  };
}

function signedQuoteFields(q: Quote, dry: boolean): Record<string, unknown> {
  const base = {
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    minAmountIn: q.minAmountIn,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    amountOutUsd: q.amountOutUsd,
    minAmountOut: q.minAmountOut,
  };
  if (dry) return base;
  return {
    ...base,
    depositAddress: q.depositAddress || undefined,
    depositMemo: q.depositMemo || undefined,
    deadline: q.deadline || undefined,
    timeWhenInactive: q.timeWhenInactive || undefined,
    timeEstimate: q.timeEstimate || undefined,
    refundFee: q.refundFee || undefined,
    withdrawFee: q.withdrawFee || undefined,
  };
}

/** base58(sha256(stable JSON of the signed fields)), as 1Click signs it. */
export function quoteHash(r: QuoteResponse): string {
  const data = stableStringify({
    ...signedRequestFields(r.quoteRequest),
    ...signedQuoteFields(r.quote, r.quoteRequest.dry),
    timestamp: r.timestamp,
  })!;
  return base58.encode(sha256(new TextEncoder().encode(data)));
}

const stripPrefix = (s: string) => (s.startsWith('ed25519:') ? s.slice(8) : s);

/**
 * True when 1Click's ed25519 signature over the quote is valid. The signature covers the
 * recipient, refund address, amounts, deposit address and the quote's deadline. It does not
 * cover `appFees`, and on a full quote the request's `deadline` is overwritten by the quote's
 * before hashing, so `checkQuote` compares both of those with what we sent.
 */
export function verifyQuoteSignature(r: QuoteResponse, signingKey = ONE_CLICK_SIGNING_KEY): boolean {
  try {
    const sig = base58.decode(stripPrefix(r.signature));
    const key = base58.decode(stripPrefix(signingKey));
    return ed25519.verify(sig, new TextEncoder().encode(quoteHash(r)), key);
  } catch {
    return false;
  }
}

/**
 * Everything ZecDoor checks before it builds a transaction from a live quote. Throws on
 * the first problem. `appFees` is not signed, so it is checked against our request here.
 */
export function checkQuote(
  r: QuoteResponse,
  sent: QuoteRequest,
  now = Date.now(),
  signingKey = ONE_CLICK_SIGNING_KEY,
): asserts r is QuoteResponse & {
  quote: Quote & { depositAddress: string };
} {
  if (!verifyQuoteSignature(r, signingKey)) throw new Error('1Click quote signature is not valid');
  const q = r.quoteRequest;
  const same: Array<keyof QuoteRequest> = [
    'dry', 'swapType', 'originAsset', 'destinationAsset', 'amount', 'refundTo', 'refundType',
    'recipient', 'recipientType', 'depositType', 'deadline',
  ];
  for (const k of same) {
    if (q[k] !== sent[k]) throw new Error(`1Click quote ${String(k)} is ${String(q[k])}, expected ${String(sent[k])}`);
  }
  // 1Click echoes the fee as rows: on Solana ZEC → ZEC one row (ours, all of it); on USDC/SOL
  // it splits our requested fee into our row and its own (live, 5 Oct 2026). The user must
  // never pay more in total than ZecDoor discloses, which is the fee we requested.
  const requested = (sent.appFees ?? []).reduce((s, f) => s + f.fee, 0);
  const rows = q.appFees ?? [];
  const charged = rows.reduce((s, f) => s + f.fee, 0);
  if (requested > 0 && !rows.some((f) => f.recipient === FEE_RECIPIENT && f.fee > 0)) {
    throw new Error('1Click quote does not carry our app fee');
  }
  if (charged > requested) throw new Error(`1Click quote charges ${charged} bps, more than the ${requested} bps disclosed`);
  if (sent.dry) return;
  const { quote } = r;
  if (!quote.depositAddress) throw new Error('1Click quote has no deposit address');
  try {
    new PublicKey(quote.depositAddress);
  } catch {
    throw new Error('1Click deposit address is not a Solana address');
  }
  if (quote.amountIn !== sent.amount) throw new Error('1Click quote amountIn differs from the amount requested');
  if (BigInt(quote.minAmountOut) > BigInt(quote.amountOut) || BigInt(quote.amountOut) <= 0n) {
    throw new Error('1Click quote output is not positive');
  }
  if (Date.parse(sent.deadline) <= now) throw new Error('1Click quote deadline has passed');
}

// ---- HTTP ----

export class OneClickClient {
  constructor(
    private readonly base = ONE_CLICK_API,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = (body as { message?: string })?.message ?? `HTTP ${res.status}`;
      throw new OneClickError(msg, res.status, body);
    }
    return body as T;
  }

  quote(req: QuoteRequest, signal?: AbortSignal): Promise<QuoteResponse> {
    return this.request('/v0/quote', { method: 'POST', body: JSON.stringify(req), ...(signal ? { signal } : {}) });
  }

  status(depositAddress: string, signal?: AbortSignal): Promise<StatusResponse> {
    return this.request(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, signal ? { signal } : {});
  }

  /** Optional speed-up. Errors are ignored (unknown addresses return HTTP 500). */
  async submitDeposit(txHash: string, depositAddress: string): Promise<void> {
    try {
      await this.request('/v0/deposit/submit', { method: 'POST', body: JSON.stringify({ txHash, depositAddress }) });
    } catch {
      /* best effort */
    }
  }

  tokens(): Promise<Array<{ assetId: string; decimals: number; price?: number; symbol?: string; blockchain?: string }>> {
    return this.request('/v0/tokens');
  }
}

/** Reads the minimum from 1Click's "Amount is too low for bridge, try at least N" error. */
export function minimumFromError(e: unknown): bigint | null {
  const m = e instanceof OneClickError ? /try at least (\d+)/.exec(e.message) : null;
  return m?.[1] ? BigInt(m[1]) : null;
}
