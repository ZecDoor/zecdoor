import { describe, expect, it } from 'vitest';
import status7FJu from '../../../../packages/solana/test/fixtures/quote_7FJu.json';
import refundedMainnet from './fixtures/status-refunded-mainnet.json';
import successB1 from './fixtures/status-success-b1.json';
import { applyStatus, refundReason } from './status';
import type { MoveRecord } from './store';
import type { QuoteResponse, StatusResponse } from '@zecdoor/solana';

const base: MoveRecord = {
  depositAddress: '7FJuHmU7KXsQn4ihiVARgmDaha9RTrf1VmcQnThzugJe',
  kind: 'exit',
  createdAt: 0,
  owner: 'Ca7HZxhhsbyzyweHx1vEbCBNQqrrxvGiicAnXo54j26F',
  amountIn: '5136740',
  amountOut: '5104740',
  minAmountOut: '5053692',
  recipient: 'u1…',
  recipientIndex: 3,
  zcashFrom: 3_506_400,
  quote: status7FJu as unknown as QuoteResponse,
  status: 'PENDING_DEPOSIT',
  updatedAt: 0,
  statusSince: 0,
  solanaSignature: '3dRKyZPDwuJzVUMmpbEd85aa37TL1TrLLEdduAwpF3wwWU5SatKQNBmUFJrBMrDgbwa9YjZEpHbnvVvpVmgDHLD8',
};

// Shape of a real SUCCESS from GET /v0/status (deposit 7FJu…, 4 Oct 2026): explorerUrl is empty.
const success: StatusResponse = {
  status: 'SUCCESS',
  updatedAt: '2026-10-04T20:40:00Z',
  swapDetails: {
    originChainTxHashes: [{ hash: base.solanaSignature!, explorerUrl: '' }],
    destinationChainTxHashes: [{ hash: 'AC36529F67CA10144DCBBE4F5214FA3D41436D54B27568D1D5168801EFE4A29A', explorerUrl: '' }],
  },
};

describe('applyStatus', () => {
  it('records the Zcash txid (lower-case) and when the status changed', () => {
    const m = applyStatus(base, success, 1000);
    expect(m.status).toBe('SUCCESS');
    expect(m.statusSince).toBe(1000);
    expect(m.zcashTxid).toBe('ac36529f67ca10144dcbbe4f5214fa3d41436d54b27568d1d5168801efe4a29a');
    expect(m.completedAt).toBeUndefined(); // a browser wallet still waits for its own arrival check
  });
  it('a pasted address completes on SUCCESS', () => {
    expect(applyStatus({ ...base, recipientIndex: null }, success, 5).completedAt).toBe(5);
  });
  it('keeps statusSince when the status repeats', () => {
    const once = applyStatus(base, { status: 'PROCESSING', updatedAt: '' }, 10);
    expect(applyStatus(once, { status: 'PROCESSING', updatedAt: '' }, 99).statusSince).toBe(10);
  });
  it('a refund takes the reason, amount and a Solana hash that is not the deposit', () => {
    const m = applyStatus(base, {
      status: 'REFUNDED',
      updatedAt: '',
      swapDetails: {
        refundReason: 'AMOUNT_LESS_THAN_MIN_AMOUNT_OUT',
        refundedAmount: '5136740',
        refundFee: '0',
        originChainTxHashes: [
          { hash: base.solanaSignature!, explorerUrl: '' },
          { hash: '3pQzWq8yQ1yS9v1Pn5mPZb2sGx7Lz4oRkX2c8f3HjYt8kV9uB6dN1aE5rT7wQ2mL4pC9xZ3sD8fG1hJ6kL0tY8k', explorerUrl: '' },
        ],
      },
    });
    expect(m.refund).toEqual({
      reason: 'AMOUNT_LESS_THAN_MIN_AMOUNT_OUT',
      amount: '5136740',
      fee: '0',
      txid: '3pQzWq8yQ1yS9v1Pn5mPZb2sGx7Lz4oRkX2c8f3HjYt8kV9uB6dN1aE5rT7wQ2mL4pC9xZ3sD8fG1hJ6kL0tY8k',
    });
    expect(m.zcashTxid).toBeUndefined();
  });
});

describe('refundReason', () => {
  it('explains the reasons seen on mainnet', () => {
    expect(refundReason('AMOUNT_LESS_THAN_MIN_AMOUNT_OUT')).toBe('The price moved past the quote’s limit');
    expect(refundReason('PARTIAL_DEPOSIT')).toBe('The deposit was smaller than the quote');
    expect(refundReason('AMOUNT_MORE_THAN_BALANCE')).toBe('More than the quoted amount arrived');
    expect(refundReason('NO_LIQUIDITY')).toBe('Not enough liquidity on the route');
    expect(refundReason(undefined)).toBe('The bridge could not complete the move');
  });
});

describe('real mainnet statuses (docs/testing)', () => {
  it('B1 SUCCESS: takes the Zcash txid as reported (explorer byte order)', () => {
    const m = { ...base, solanaSignature: '2ZfeRtsivSk7UCrsTenJ5dL1GoArXyK2aCRH1RE8uFUR6XMEgjvVBLtc1JWnigb44FBTbauSvqc3xtBUmJJ9ZQLa' };
    const r = applyStatus(m, successB1 as unknown as StatusResponse, 1);
    expect(r.status).toBe('SUCCESS');
    expect(r.zcashTxid).toBe('2fac74310c294c306f56bb9d60891af9d0f8f2ff9c4244f77e1939cf7df206d6');
  });
  it('refund probe: the refund is the origin hash after the deposit, with reason, amount and fee', () => {
    const m = { ...base, solanaSignature: '5BPG29y5mu52DigA2uGCLtXHG17a26njTx3vYhp52sFGHRWwKzKHpfG9y4drqWR6paVGGV5vxc8FJjjdmMSXTuhM' };
    const r = applyStatus(m, refundedMainnet as unknown as StatusResponse, 1);
    expect(r.status).toBe('REFUNDED');
    expect(r.refund).toEqual({
      reason: 'PARTIAL_DEPOSIT',
      amount: '29240',
      fee: '763',
      txid: '3kdVEQS27gJTnHXzFvRrNWJaWdAH2aCZg9qr3CdKFLSxXM5yT8Mt1uQoh4wXhiCN6ux5djwjrJLjbRFadt8mSXcP',
    });
    expect(refundReason('PARTIAL_DEPOSIT')).toBe('The deposit was smaller than the quote');
  });
});
