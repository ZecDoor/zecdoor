// The instruction allowlist. Every transaction ZecDoor asks a user to sign is checked here,
// at run time before Phantom sees it, and in tests that block the build. It proves the
// transaction can only:
//   - set compute budget,
//   - create token accounts paid by the user, for the user or for the deposit address,
//   - send exactly the quoted amount from the user to the quote's deposit address,
//   - (top-up only) run one Jupiter exact-output swap from the user's own SOL or USDC into the
//     user's own ZEC account, wrap the user's SOL for it (capped), and close the wrapper,
//   - close the user's own emptied accounts, with the rent going back to the user.
// Anything else — another destination, another amount, approvals, authority changes, other
// programs, a second signer — is a violation.

import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ata } from './build.js';
import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  JUPITER_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  USDC_MINT,
  WSOL_MINT,
  ZEC_MINT,
} from './constants.js';
import type { MoveKind } from './oneclick.js';

export interface AllowlistContext {
  kind: MoveKind;
  owner: PublicKey;
  depositAddress: PublicKey;
  amountIn: bigint;
  /** Needed when the transaction uses address lookup tables. */
  lookupTables?: AddressLookupTableAccount[];
  /** Top-up: the most lamports the user may wrap for Jupiter (the quote's max input). */
  maxWrapLamports?: bigint;
}

export interface AllowlistResult {
  ok: boolean;
  violations: string[];
}

const MINT_FOR: Record<MoveKind, PublicKey | null> = { exit: ZEC_MINT, topup: ZEC_MINT, buyUsdc: USDC_MINT, buySol: null };
const OWNER_MINTS = [ZEC_MINT, USDC_MINT, WSOL_MINT];
const SWAP_INPUT_MINTS = [WSOL_MINT, USDC_MINT];

/**
 * Account positions in Jupiter v6's exact-output routes, keyed by Anchor discriminator
 * (sha256("global:<name>")[0..8]). Layouts are from the program's on-chain IDL, read
 * 5 Oct 2026. The top-up only ever asks Jupiter for ExactOut, so other routes are refused.
 * An optional account that is absent is passed as the Jupiter program id.
 */
interface RouteLayout {
  authority: number;
  source: number;
  destination: number;
  destinationOverride?: number;
  sourceMint: number;
  destinationMint: number;
  platformFee?: number;
}
const JUPITER_EXACT_OUT: Record<string, RouteLayout> = {
  // exact_out_route
  d033ef977b2bed5c: { authority: 1, source: 2, destination: 3, destinationOverride: 4, sourceMint: 5, destinationMint: 6, platformFee: 7 },
  // shared_accounts_exact_out_route
  b0d169a89a7d453e: { authority: 2, source: 3, destination: 6, sourceMint: 7, destinationMint: 8, platformFee: 9 },
  // exact_out_route_v2
  '9d8ab85215f4f324': { authority: 0, source: 1, destination: 2, destinationOverride: 7, sourceMint: 3, destinationMint: 4 },
  // shared_accounts_exact_out_route_v2
  '3560e5cad8bbfa18': { authority: 1, source: 2, destination: 5, sourceMint: 6, destinationMint: 7 },
};

const u64 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 8).getBigUint64(0, true);
const u32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 4).getUint32(0, true);

export function checkTransaction(tx: VersionedTransaction, ctx: AllowlistContext): AllowlistResult {
  const v: string[] = [];
  const msg = tx.message;
  const keys = msg.staticAccountKeys;

  if (msg.version !== 0) v.push('not a v0 transaction');
  if (msg.header.numRequiredSignatures !== 1) v.push(`needs ${msg.header.numRequiredSignatures} signers, expected only the user`);
  if (!keys[0]?.equals(ctx.owner)) v.push('fee payer is not the user');

  let ixs: TransactionInstruction[];
  try {
    ixs = TransactionMessage.decompile(msg, { addressLookupTableAccounts: ctx.lookupTables ?? [] }).instructions;
  } catch (e) {
    return { ok: false, violations: [...v, `cannot decompile: ${(e as Error).message}`] };
  }

  const owner = ctx.owner;
  const depositMint = MINT_FOR[ctx.kind];
  const ownerAtas = OWNER_MINTS.map((m) => ata(m, owner));
  const isOwnerAta = (k: PublicKey) => ownerAtas.some((a) => a.equals(k));
  const ownerWsol = ata(WSOL_MINT, owner);
  let deposits = 0;
  let swaps = 0;

  ixs.forEach((ix, i) => {
    const at = `instruction ${i}`;
    const p = ix.programId;
    const d = ix.data;
    const acct = (n: number) => ix.keys[n]?.pubkey;

    if (p.equals(COMPUTE_BUDGET_PROGRAM)) {
      // 2 = SetComputeUnitLimit, 3 = SetComputeUnitPrice
      if (d[0] !== 2 && d[0] !== 3) v.push(`${at}: compute budget instruction ${d[0]} not allowed`);
      return;
    }

    if (p.equals(ATA_PROGRAM)) {
      // [] / [0] = Create, [1] = CreateIdempotent. Accounts: payer, ata, wallet, mint, system, token.
      if (d.length > 1 || (d.length === 1 && d[0] !== 0 && d[0] !== 1)) {
        v.push(`${at}: associated-token instruction ${d[0]} not allowed`);
        return;
      }
      const [payer, account, wallet, mint] = [acct(0), acct(1), acct(2), acct(3)];
      if (!payer?.equals(owner)) v.push(`${at}: token account not paid by the user`);
      if (!account || !wallet || !mint || !account.equals(ata(mint, wallet))) {
        v.push(`${at}: not an associated token account`);
        return;
      }
      const forDeposit = wallet.equals(ctx.depositAddress) && depositMint !== null && mint.equals(depositMint);
      const forOwner = wallet.equals(owner) && OWNER_MINTS.some((m) => m.equals(mint));
      if (!forDeposit && !forOwner) v.push(`${at}: token account for an unexpected owner or mint`);
      if (forOwner && ctx.kind !== 'topup') v.push(`${at}: creates a user token account outside a top-up`);
      return;
    }

    if (p.equals(TOKEN_PROGRAM)) {
      const op = d[0];
      if (op === 12) {
        // TransferChecked: source, mint, destination, authority; amount u64, decimals u8
        deposits++;
        const [src, mint, dst, auth] = [acct(0), acct(1), acct(2), acct(3)];
        const amount = d.length >= 9 ? u64(d, 1) : -1n;
        if (!depositMint) v.push(`${at}: token transfer in a SOL buy`);
        else {
          if (!mint?.equals(depositMint)) v.push(`${at}: transfers the wrong token`);
          if (!src?.equals(ata(depositMint, owner))) v.push(`${at}: source is not the user's account`);
          if (!dst?.equals(ata(depositMint, ctx.depositAddress))) v.push(`${at}: destination is not the deposit address`);
        }
        if (!auth?.equals(owner)) v.push(`${at}: transfer authority is not the user`);
        if (amount !== ctx.amountIn) v.push(`${at}: amount ${amount} is not the quoted ${ctx.amountIn}`);
        return;
      }
      if (op === 17) {
        // SyncNative: only the user's own wrapped-SOL account, only around a top-up swap.
        if (ctx.kind !== 'topup' || !acct(0)?.equals(ownerWsol)) v.push(`${at}: sync-native not allowed here`);
        return;
      }
      if (op === 9) {
        // CloseAccount: account, destination, owner
        if (!acct(0) || !isOwnerAta(acct(0)!)) v.push(`${at}: closes an account that is not the user's`);
        if (!acct(1)?.equals(owner)) v.push(`${at}: rent would go to someone other than the user`);
        if (!acct(2)?.equals(owner)) v.push(`${at}: close authority is not the user`);
        return;
      }
      v.push(`${at}: token instruction ${op} not allowed`);
      return;
    }

    if (p.equals(SYSTEM_PROGRAM)) {
      // Transfer = u32 2, then u64 lamports. Accounts: from, to.
      if (d.length !== 12 || u32(d, 0) !== 2) {
        v.push(`${at}: system instruction not allowed`);
        return;
      }
      const [from, to] = [acct(0), acct(1)];
      const lamports = u64(d, 4);
      if (!from?.equals(owner)) v.push(`${at}: system transfer not from the user`);
      if (ctx.kind === 'buySol' && to?.equals(ctx.depositAddress)) {
        deposits++;
        if (lamports !== ctx.amountIn) v.push(`${at}: sends ${lamports} lamports, quoted ${ctx.amountIn}`);
      } else if (ctx.kind === 'topup' && to?.equals(ownerWsol)) {
        if (ctx.maxWrapLamports === undefined || lamports > ctx.maxWrapLamports) {
          v.push(`${at}: wraps ${lamports} lamports, more than the swap needs`);
        }
      } else v.push(`${at}: system transfer to an unexpected account`);
      return;
    }

    if (p.equals(JUPITER_PROGRAM)) {
      swaps++;
      if (ctx.kind !== 'topup') {
        v.push(`${at}: swap outside a top-up`);
        return;
      }
      const layout = JUPITER_EXACT_OUT[Buffer.from(d.subarray(0, 8)).toString('hex')];
      if (!layout) {
        v.push(`${at}: Jupiter instruction is not an exact-output route`);
        return;
      }
      const auth = ix.keys[layout.authority];
      const src = acct(layout.source);
      const srcMint = acct(layout.sourceMint);
      const override = layout.destinationOverride === undefined ? undefined : acct(layout.destinationOverride);
      const dst = override && !override.equals(JUPITER_PROGRAM) ? override : acct(layout.destination);
      const fee = layout.platformFee === undefined ? undefined : acct(layout.platformFee);
      if (!auth?.pubkey.equals(owner) || !auth.isSigner) v.push(`${at}: swap is not authorised by the user`);
      if (!srcMint || !SWAP_INPUT_MINTS.some((m) => m.equals(srcMint))) v.push(`${at}: swap spends an unexpected token`);
      else if (!src?.equals(ata(srcMint, owner))) v.push(`${at}: swap spends from an account that is not the user's`);
      if (!acct(layout.destinationMint)?.equals(ZEC_MINT)) v.push(`${at}: swap does not buy ZEC`);
      if (!dst?.equals(ata(ZEC_MINT, owner))) v.push(`${at}: swap output is not the user's ZEC account`);
      if (fee && !fee.equals(JUPITER_PROGRAM)) v.push(`${at}: swap carries a platform fee account`);
      const touchesDeposit = ix.keys.some(
        (k) => k.pubkey.equals(ctx.depositAddress) || k.pubkey.equals(ata(ZEC_MINT, ctx.depositAddress)),
      );
      if (touchesDeposit) v.push(`${at}: swap touches the deposit address`);
      return;
    }

    v.push(`${at}: program ${p.toBase58()} is not allowed`);
  });

  if (deposits !== 1) v.push(`expected exactly one deposit transfer, found ${deposits}`);
  if (ctx.kind === 'topup' && swaps !== 1) v.push(`top-up needs exactly one swap, found ${swaps}`);
  if (ctx.kind !== 'topup' && swaps !== 0) v.push('swap in a transaction that is not a top-up');
  return { ok: v.length === 0, violations: v };
}

export function assertAllowed(tx: VersionedTransaction, ctx: AllowlistContext): void {
  const r = checkTransaction(tx, ctx);
  if (!r.ok) throw new Error(`Refusing to ask for a signature:\n- ${r.violations.join('\n- ')}`);
}
