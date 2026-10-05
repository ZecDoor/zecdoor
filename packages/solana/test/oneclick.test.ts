import { quoteHash as sdkQuoteHash, verifyQuoteSignature as sdkVerify } from '@defuse-protocol/one-click-sdk-typescript';
import { describe, expect, it } from 'vitest';
import { APP_FEE_BPS, ASSET, FEE_RECIPIENT, MIN_SOLANA_ZEC_ZAT, minimumWithFee } from '../src/constants.js';
import { checkQuote, makeQuoteRequest, minimumFromError, OneClickError, quoteHash, verifyQuoteSignature, type QuoteResponse } from '../src/oneclick.js';
import { stableStringify } from '../src/stable-json.js';
import q5inx from './fixtures/quote_5inxULEV.json';
import q7FJu from './fixtures/quote_7FJu.json';
import qCETP from './fixtures/quote_CETPvNMB.json';
import qHedx from './fixtures/quote_HedxBKv6.json';

// Real signed quotes from 1Click /v0/status on mainnet swaps (build-plan/mainnet-test/live).
const fixtures = { q5inx, q7FJu, qCETP, qHedx } as unknown as Record<string, QuoteResponse>;
const clone = (q: QuoteResponse): QuoteResponse => JSON.parse(JSON.stringify(q));

describe('quote signature', () => {
  for (const [name, q] of Object.entries(fixtures)) {
    it(`${name}: our hash equals the 1Click SDK's and the signature verifies`, () => {
      expect(quoteHash(q)).toBe(sdkQuoteHash(q as never));
      expect(sdkVerify(q as never)).toBe(true);
      expect(verifyQuoteSignature(q)).toBe(true);
    });
  }

  const tamper: Array<[string, (q: QuoteResponse) => void]> = [
    ['recipient', (q) => (q.quoteRequest.recipient = q.quoteRequest.recipient.slice(0, -1) + 'x')],
    ['refundTo', (q) => (q.quoteRequest.refundTo = '11111111111111111111111111111111')],
    ['amount', (q) => (q.quoteRequest.amount = String(BigInt(q.quoteRequest.amount) + 1n))],
    ['amountIn', (q) => (q.quote.amountIn = String(BigInt(q.quote.amountIn) + 1n))],
    ['amountOut', (q) => (q.quote.amountOut = String(BigInt(q.quote.amountOut) + 1n))],
    ['depositAddress', (q) => (q.quote.depositAddress = 'HbC6R4UQQVBzhFr5QSnsriL58yaH9wf6qwNZH9hXJhQ1')],
    ['quote deadline', (q) => (q.quote.deadline = '2030-01-01T00:00:00.000Z')],
    ['timestamp', (q) => (q.timestamp = '2026-01-01T00:00:00.000Z')],
    ['signature', (q) => (q.signature = q.signature.slice(0, -2) + (q.signature.endsWith('11') ? '22' : '11'))],
  ];
  for (const [field, mutate] of tamper) {
    it(`fails when ${field} is changed`, () => {
      const q = clone(fixtures.q5inx!);
      mutate(q);
      expect(verifyQuoteSignature(q)).toBe(false);
    });
  }

  it('does not cover appFees (so checkQuote checks them separately)', () => {
    const q = clone(fixtures.q5inx!);
    q.quoteRequest.appFees = [{ recipient: FEE_RECIPIENT, fee: 500 }];
    expect(verifyQuoteSignature(q)).toBe(true);
  });

  it("does not cover the request deadline of a full quote (the quote's deadline replaces it)", () => {
    const q = clone(fixtures.q5inx!);
    q.quoteRequest.deadline = '2030-01-01T00:00:00.000Z';
    expect(verifyQuoteSignature(q)).toBe(true);
  });

  it('rejects a signature from another key', () => {
    expect(verifyQuoteSignature(fixtures.q5inx!, 'ed25519:HbC6R4UQQVBzhFr5QSnsriL58yaH9wf6qwNZH9hXJhQ1')).toBe(false);
  });
});

describe('stableStringify', () => {
  it('sorts keys, drops undefined, keeps arrays in order', () => {
    expect(stableStringify({ b: 1, a: [3, undefined, { d: undefined, c: 'x' }], e: undefined })).toBe(
      '{"a":[3,null,{"c":"x"}],"b":1}',
    );
  });
});

describe('makeQuoteRequest', () => {
  it('builds an exact-input Solana ZEC exit carrying our fee and no referral', () => {
    const r = makeQuoteRequest({ kind: 'exit', amount: 133_334n, recipient: 'u1abc', refundTo: 'So1', dry: true, now: 0 });
    expect(r).toMatchObject({
      swapType: 'EXACT_INPUT',
      originAsset: ASSET.solanaZec,
      destinationAsset: ASSET.zec,
      amount: '133334',
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      deadline: '1970-01-01T00:30:00.000Z',
      appFees: [{ recipient: FEE_RECIPIENT, fee: APP_FEE_BPS.exit }],
    });
    expect(r.referral).toBeUndefined();
  });
  it('uses USDC and SOL origins for buys', () => {
    expect(makeQuoteRequest({ kind: 'buyUsdc', amount: 1n, recipient: 'u', refundTo: 's', dry: true }).originAsset).toBe(ASSET.solanaUsdc);
    expect(makeQuoteRequest({ kind: 'buySol', amount: 1n, recipient: 'u', refundTo: 's', dry: true }).appFees).toEqual([
      { recipient: FEE_RECIPIENT, fee: 50 },
    ]);
  });
});

describe('checkQuote', () => {
  const before = (q: QuoteResponse) => Date.parse(q.quoteRequest.deadline) - 60_000;
  const sentFor = (q: QuoteResponse) => ({ ...q.quoteRequest, appFees: [] });

  it('accepts a genuine quote that matches the request', () => {
    const q = fixtures.q5inx!;
    expect(() => checkQuote(q, sentFor(q), before(q))).not.toThrow();
  });
  it('rejects an expired quote', () => {
    const q = fixtures.q5inx!;
    expect(() => checkQuote(q, sentFor(q), Date.parse(q.quoteRequest.deadline) + 1)).toThrow(/deadline/);
  });
  it('rejects a quote whose echoed deadline differs from ours', () => {
    const q = fixtures.q5inx!;
    expect(() => checkQuote(q, { ...sentFor(q), deadline: '2026-10-04T08:15:00.000Z' }, before(q))).toThrow(/deadline/);
  });
  it('rejects a quote for a different recipient than we asked for', () => {
    const q = fixtures.q5inx!;
    expect(() => checkQuote(q, { ...sentFor(q), recipient: 'u1someoneelse' }, before(q))).toThrow(/recipient/);
  });
  it('rejects a quote whose refund goes elsewhere', () => {
    const q = fixtures.q5inx!;
    expect(() => checkQuote(q, { ...sentFor(q), refundTo: '11111111111111111111111111111111' }, before(q))).toThrow(/refundTo/);
  });
  it('rejects a forged quote', () => {
    const q = clone(fixtures.q5inx!);
    q.quote.depositAddress = 'HbC6R4UQQVBzhFr5QSnsriL58yaH9wf6qwNZH9hXJhQ1';
    expect(() => checkQuote(q, sentFor(q), before(q))).toThrow(/signature/);
  });
  it('rejects a quote charging fees we did not disclose', () => {
    // A real quote from another app, carrying its 67 bps fee.
    const q = fixtures.qCETP!;
    expect(() => checkQuote(q, sentFor(q), before(q))).toThrow(/more than/);
  });
  it('rejects a quote that drops our fee row', () => {
    const q = fixtures.qCETP!;
    const sent = { ...q.quoteRequest, appFees: [{ recipient: FEE_RECIPIENT, fee: 67 }] };
    expect(() => checkQuote(q, sent, before(q))).toThrow(/our app fee/);
  });
});

describe('minimumWithFee', () => {
  it('matches what 1Click reports for a 25 bps fee', () => {
    expect(minimumWithFee(MIN_SOLANA_ZEC_ZAT, 25)).toBe(133_669n);
    expect(minimumWithFee(MIN_SOLANA_ZEC_ZAT, 0)).toBe(MIN_SOLANA_ZEC_ZAT);
  });
});

describe('minimumFromError', () => {
  it('reads the bridge minimum', () => {
    expect(minimumFromError(new OneClickError('Amount is too low for bridge, try at least 133334', 400, {}))).toBe(133_334n);
    expect(minimumFromError(new Error('other'))).toBeNull();
  });
});
