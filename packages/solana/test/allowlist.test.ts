// Build-blocking: `pnpm test` (and the app's prebuild) fails if any of these fail.
// Each valid move must pass the allowlist, and each way of turning it against the user must not.

import {
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSetAuthorityInstruction,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { checkTransaction, type AllowlistContext } from '../src/allowlist.js';
import {
  ata,
  buySolInstructions,
  buyUsdcInstructions,
  compile,
  exitInstructions,
  MAX_TX_BYTES,
  topUpInstructions,
  type MoveContext,
} from '../src/build.js';
import { JUPITER_PROGRAM, USDC_MINT, WSOL_MINT, ZEC_DECIMALS, ZEC_MINT } from '../src/constants.js';
import type { JupiterSwap } from '../src/jupiter.js';
import type { MoveKind } from '../src/oneclick.js';
import alts from './fixtures/jup_alts.json';
import jupQuote from './fixtures/jup_quote.json';
import jupIx from './fixtures/jup_swap_ix.json';

const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
const owner = new PublicKey('3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5'); // the Jupiter fixture's wallet
const deposit = new PublicKey('5inxULEVxHRHaF7DrBgAiesEYXG5ytzFnDquP6nvJnXz');
const attacker = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const AMOUNT = 133_334n;

const tables = Object.entries(alts).map(
  ([key, addresses]) =>
    new AddressLookupTableAccount({
      key: new PublicKey(key),
      state: {
        deactivationSlot: 2n ** 64n - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: (addresses as string[]).map((a) => new PublicKey(a)),
      },
    }),
);

type RawIx = { programId: string; accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; data: string };
const toIx = (ix: RawIx) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });
const swapFixture = (): JupiterSwap => ({
  quote: jupQuote as never,
  setup: (jupIx.setupInstructions as RawIx[]).map(toIx),
  swap: toIx(jupIx.swapInstruction as RawIx),
  cleanup: [toIx(jupIx.cleanupInstruction as RawIx)],
  lookupTables: jupIx.addressLookupTableAddresses,
});
const MAX_WRAP = BigInt(jupQuote.otherAmountThreshold);

const ctxFor = (kind: MoveKind, amountIn = AMOUNT): MoveContext => ({ kind, owner, depositAddress: deposit, amountIn });
const allowCtx = (kind: MoveKind, extra: Partial<AllowlistContext> = {}): AllowlistContext => ({
  ...ctxFor(kind),
  lookupTables: kind === 'topup' ? tables : [],
  ...(kind === 'topup' ? { maxWrapLamports: MAX_WRAP } : {}),
  ...extra,
});
const tx = (instructions: TransactionInstruction[], kind: MoveKind, payer = owner) =>
  compile({ payer, instructions, blockhash: BLOCKHASH, lookupTables: kind === 'topup' ? tables : [] });

const baseIxs: Record<MoveKind, () => TransactionInstruction[]> = {
  exit: () => exitInstructions(ctxFor('exit')),
  topup: () => topUpInstructions(ctxFor('topup'), swapFixture()),
  buyUsdc: () => buyUsdcInstructions(ctxFor('buyUsdc')),
  buySol: () => buySolInstructions(ctxFor('buySol')),
};

const expectOk = (t: VersionedTransaction, c: AllowlistContext) => {
  const r = checkTransaction(t, c);
  expect(r.violations).toEqual([]);
  expect(r.ok).toBe(true);
};
const expectBlocked = (t: VersionedTransaction, c: AllowlistContext, match: RegExp) => {
  const r = checkTransaction(t, c);
  expect(r.ok).toBe(false);
  expect(r.violations.join('\n')).toMatch(match);
};

const zecTransfer = (dst: PublicKey, amount = AMOUNT, auth = owner) =>
  createTransferCheckedInstruction(ata(ZEC_MINT, owner), ZEC_MINT, dst, auth, amount, ZEC_DECIMALS);
const swapIndex = (ixs: TransactionInstruction[]) => ixs.findIndex((i) => i.programId.equals(JUPITER_PROGRAM));
const withSwapAccount = (n: number, key: PublicKey, signer?: boolean) => {
  const ixs = baseIxs.topup();
  const s = ixs[swapIndex(ixs)]!;
  s.keys[n] = { ...s.keys[n]!, pubkey: key, ...(signer !== undefined ? { isSigner: signer } : {}) };
  return ixs;
};

describe('allowlist: valid moves pass', () => {
  for (const kind of ['exit', 'topup', 'buyUsdc', 'buySol'] as MoveKind[]) {
    it(kind, () => {
      const t = tx(baseIxs[kind](), kind);
      expectOk(t, allowCtx(kind));
      expect(t.serialize().length).toBeLessThanOrEqual(MAX_TX_BYTES);
    });
  }
  it('exit that closes the emptied account, rent back to the user', () => {
    expectOk(tx(exitInstructions(ctxFor('exit'), { closeEmptied: true }), 'exit'), allowCtx('exit'));
  });
  it('the real Jupiter route is a shared exact-out route into the user\'s ZEC account', () => {
    const ixs = baseIxs.topup();
    const s = ixs[swapIndex(ixs)]!;
    expect(Buffer.from(s.data.subarray(0, 8)).toString('hex')).toBe('b0d169a89a7d453e');
    expect(s.keys[6]!.pubkey.equals(ata(ZEC_MINT, owner))).toBe(true);
  });
});

describe('allowlist: exit attacks are blocked', () => {
  const exitWith = (ixs: TransactionInstruction[], payer = owner) => tx(ixs, 'exit', payer);
  const ok = () => baseIxs.exit();
  const cases: Array<[string, () => VersionedTransaction, RegExp, Partial<AllowlistContext>?]> = [
    ['amount one unit higher', () => exitWith([ok()[0]!, zecTransfer(ata(ZEC_MINT, deposit), AMOUNT + 1n)]), /not the quoted/],
    ['amount one unit lower', () => exitWith([ok()[0]!, zecTransfer(ata(ZEC_MINT, deposit), AMOUNT - 1n)]), /not the quoted/],
    ['sends to another address', () => exitWith([zecTransfer(ata(ZEC_MINT, attacker))]), /destination is not the deposit/],
    ['adds an unchecked transfer', () => exitWith([...ok(), createTransferInstruction(ata(ZEC_MINT, owner), ata(ZEC_MINT, attacker), owner, 1n)]), /token instruction 3/],
    ['approves a delegate', () => exitWith([...ok(), createApproveInstruction(ata(ZEC_MINT, owner), attacker, owner, 10n ** 12n)]), /token instruction 4/],
    ['hands over account ownership', () => exitWith([...ok(), createSetAuthorityInstruction(ata(ZEC_MINT, owner), owner, AuthorityType.AccountOwner, attacker)]), /token instruction 6/],
    ['closes an account with rent to someone else', () => exitWith([...ok(), createCloseAccountInstruction(ata(ZEC_MINT, owner), attacker, owner)]), /rent would go/],
    ['creates a token account for someone else', () => exitWith([...ok(), createAssociatedTokenAccountIdempotentInstruction(owner, ata(ZEC_MINT, attacker), attacker, ZEC_MINT)]), /unexpected owner/],
    ['creates a user token account outside a top-up', () => exitWith([...ok(), createAssociatedTokenAccountIdempotentInstruction(owner, ata(USDC_MINT, owner), owner, USDC_MINT)]), /outside a top-up/],
    ['token account paid by someone else (second signer)', () => exitWith([createAssociatedTokenAccountIdempotentInstruction(attacker, ata(ZEC_MINT, deposit), deposit, ZEC_MINT), ok()[1]!]), /not paid by the user|signers/],
    ['fee payer is not the user', () => exitWith(ok(), attacker), /fee payer/],
    ['an unknown program', () => exitWith([...ok(), new TransactionInstruction({ programId: attacker, keys: [], data: Buffer.alloc(0) })]), /not allowed/],
    ['Token-2022 transfer', () => exitWith([...ok(), createTransferCheckedInstruction(ata(ZEC_MINT, owner), ZEC_MINT, ata(ZEC_MINT, attacker), owner, 1n, 8, [], TOKEN_2022_PROGRAM_ID)]), /not allowed/],
    ['two deposits', () => exitWith([...ok(), zecTransfer(ata(ZEC_MINT, deposit))]), /exactly one deposit/],
    ['no deposit', () => exitWith([ok()[0]!]), /exactly one deposit/],
    ['transfer signed by someone else', () => exitWith([ok()[0]!, zecTransfer(ata(ZEC_MINT, deposit), AMOUNT, attacker)]), /authority is not the user/],
    ['heap-frame request', () => exitWith([ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }), ...ok()]), /compute budget instruction 1/],
    ['SOL sent to someone', () => exitWith([...ok(), SystemProgram.transfer({ fromPubkey: owner, toPubkey: attacker, lamports: 1 })]), /unexpected account/],
    ['assigns the wallet to another program', () => exitWith([...ok(), SystemProgram.assign({ accountPubkey: owner, programId: attacker })]), /system instruction not allowed/],
    ['a swap inside an exit', () => exitWith([...ok(), swapFixture().swap]), /swap outside a top-up/],
  ];
  for (const [name, build, match, extra] of cases) it(name, () => expectBlocked(build(), allowCtx('exit', extra), match));

  it('a legacy transaction', () => {
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: BLOCKHASH, instructions: ok() }).compileToLegacyMessage();
    expectBlocked(new VersionedTransaction(msg), allowCtx('exit'), /not a v0/);
  });
  it('a quote for a different amount than the transaction', () => {
    expectBlocked(tx(ok(), 'exit'), allowCtx('exit', { amountIn: AMOUNT * 2n }), /not the quoted/);
  });
  it('a different deposit address than the quote', () => {
    expectBlocked(tx(ok(), 'exit'), allowCtx('exit', { depositAddress: attacker }), /deposit/);
  });
});

describe('allowlist: top-up attacks are blocked', () => {
  const topup = (ixs: TransactionInstruction[]) => tx(ixs, 'topup');
  const cases: Array<[string, () => TransactionInstruction[], RegExp, Partial<AllowlistContext>?]> = [
    ['swap output redirected', () => withSwapAccount(6, ata(ZEC_MINT, attacker)), /output is not the user's ZEC/],
    ['swap carries a platform fee account', () => withSwapAccount(9, ata(ZEC_MINT, attacker)), /platform fee/],
    ['swap authorised by someone else', () => withSwapAccount(2, attacker, true), /not authorised by the user|signers/],
    ['swap spends from someone else\'s account', () => withSwapAccount(3, ata(WSOL_MINT, attacker)), /not the user's/],
    ['swap buys something other than ZEC', () => withSwapAccount(8, USDC_MINT), /does not buy ZEC/],
    ['swap pays the deposit address directly', () => withSwapAccount(6, ata(ZEC_MINT, deposit)), /output is not the user's ZEC|touches the deposit/],
    [
      'exact-input route (not what the top-up asks for)',
      () => {
        const ixs = baseIxs.topup();
        Buffer.from('e517cb977ae3ad2a', 'hex').copy(ixs[swapIndex(ixs)]!.data, 0);
        return ixs;
      },
      /not an exact-output route/,
    ],
    [
      'wraps more SOL than the swap can use',
      () => baseIxs.topup().map((i) => (i.programId.equals(SystemProgram.programId) ? SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata(WSOL_MINT, owner), lamports: MAX_WRAP + 1n }) : i)),
      /more than the swap needs/,
    ],
    ['no wrap cap given', () => baseIxs.topup(), /more than the swap needs/, { maxWrapLamports: undefined }],
    ['sync-native on another account', () => [...baseIxs.topup(), createSyncNativeInstruction(ata(WSOL_MINT, attacker))], /sync-native/],
    ['two swaps', () => { const i = baseIxs.topup(); return [...i, i[swapIndex(i)]!]; }, /exactly one swap/],
    ['no swap', () => baseIxs.topup().filter((i) => !i.programId.equals(JUPITER_PROGRAM)), /exactly one swap/],
  ];
  for (const [name, build, match, extra] of cases) {
    it(name, () => {
      const c = allowCtx('topup', extra);
      if (extra && 'maxWrapLamports' in extra && extra.maxWrapLamports === undefined) delete c.maxWrapLamports;
      expectBlocked(topup(build()), c, match);
    });
  }
  it('fails closed when lookup tables are missing', () => {
    expectBlocked(topup(baseIxs.topup()), allowCtx('topup', { lookupTables: [] }), /cannot decompile/);
  });
});

describe('allowlist: buy attacks are blocked', () => {
  it('SOL buy for a different amount', () => {
    const t = tx([SystemProgram.transfer({ fromPubkey: owner, toPubkey: deposit, lamports: AMOUNT + 1n })], 'buySol');
    expectBlocked(t, allowCtx('buySol'), /quoted/);
  });
  it('SOL buy sent elsewhere', () => {
    const t = tx([SystemProgram.transfer({ fromPubkey: owner, toPubkey: attacker, lamports: AMOUNT })], 'buySol');
    expectBlocked(t, allowCtx('buySol'), /unexpected account/);
  });
  it('token transfer in a SOL buy', () => {
    expectBlocked(tx([...baseIxs.buySol(), zecTransfer(ata(ZEC_MINT, deposit))], 'buySol'), allowCtx('buySol'), /token transfer in a SOL buy/);
  });
  it('USDC buy that sends ZEC instead', () => {
    const t = tx([createTransferCheckedInstruction(ata(ZEC_MINT, owner), ZEC_MINT, ata(USDC_MINT, deposit), owner, AMOUNT, 8)], 'buyUsdc');
    expectBlocked(t, allowCtx('buyUsdc'), /wrong token/);
  });
  it('USDC buy with a ZEC token account for the deposit', () => {
    const t = tx([createAssociatedTokenAccountIdempotentInstruction(owner, ata(ZEC_MINT, deposit), deposit, ZEC_MINT), ...baseIxs.buyUsdc().slice(1)], 'buyUsdc');
    expectBlocked(t, allowCtx('buyUsdc'), /unexpected owner or mint/);
  });
});
