// The wallet connection. Wallet Standard discovery (@solana/kit-plugin-wallet) is the main path;
// Phantom's injected provider (lib/phantom.ts) is the fallback when Phantom is in the page but has
// not registered as a Wallet Standard wallet. ZecDoor only ever asks a wallet to connect, disconnect
// and signAndSendTransaction: never signMessage, never signTransaction, never signAllTransactions.

import { createClient, getBase58Decoder, getTransactionDecoder } from '@solana/kit';
import { walletWithoutSigner, type WalletState } from '@solana/kit-plugin-wallet';
import type { VersionedTransaction } from '@solana/web3.js';
import { getPhantom, type PhantomSolana } from './phantom';
import { WalletError } from './wallet-error';

/** Wallets we have tested end to end on mainnet. Others are listed but cannot be picked. */
export const SUPPORTED = new Set(['Phantom']);
const SIGN_AND_SEND = 'solana:signAndSendTransaction';
/** How long the legacy provider waits for Phantom to register before reconnecting silently. */
const LEGACY_GRACE_MS = 3000;

type StdWallet = WalletState['wallets'][number];

export interface WalletOption {
  name: string;
  icon: string | null;
  supported: boolean;
  legacy: boolean;
}

export interface WalletSnapshot {
  /** False until the silent reconnect has settled, so the page does not flash "Connect". */
  ready: boolean;
  options: WalletOption[];
  connected: { name: string; icon: string | null; address: string } | null;
  connecting: boolean;
}

export { WalletError };

const client = createClient().use(
  walletWithoutSigner({
    chain: 'solana:mainnet',
    storageKey: 'zecdoor:wallet',
    filter: (w) => w.features.includes(SIGN_AND_SEND),
  }),
);

let legacy: PhantomSolana | null = null;
let legacyOwner: string | null = null;
let legacyConnecting = false;
let graceOver = false;
const listeners = new Set<() => void>();
let snapshot: WalletSnapshot = { ready: false, options: [], connected: null, connecting: false };

const stdPhantom = (): StdWallet | undefined => client.wallet.getState().wallets.find((w) => w.name === 'Phantom');

function compute(): WalletSnapshot {
  const s = client.wallet.getState();
  const options: WalletOption[] = s.wallets.map((w) => ({ name: w.name, icon: w.icon ?? null, supported: SUPPORTED.has(w.name), legacy: false }));
  if (legacy && !stdPhantom()) options.push({ name: 'Phantom', icon: null, supported: true, legacy: true });
  options.sort((a, b) => Number(b.supported) - Number(a.supported));
  const connected = legacyOwner
    ? { name: 'Phantom', icon: null, address: legacyOwner }
    : s.connected
      ? { name: s.connected.wallet.name, icon: s.connected.wallet.icon ?? null, address: s.connected.account.address }
      : null;
  const warming = s.status === 'pending' || s.status === 'reconnecting';
  return { ready: !warming, options, connected, connecting: s.status === 'connecting' || legacyConnecting };
}

function notify() {
  const next = compute();
  const same =
    next.ready === snapshot.ready &&
    next.connecting === snapshot.connecting &&
    next.connected?.address === snapshot.connected?.address &&
    next.connected?.name === snapshot.connected?.name &&
    next.options.map((o) => `${o.name}:${o.legacy}`).join() === snapshot.options.map((o) => `${o.name}:${o.legacy}`).join();
  if (same) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function attachLegacy(p: PhantomSolana) {
  if (legacy) return;
  legacy = p;
  p.on('accountChanged', (pk?: unknown) => {
    if (!legacyOwner) return;
    legacyOwner = pk ? String(pk) : null;
    notify();
  });
  p.on('disconnect', () => {
    legacyOwner = null;
    notify();
  });
  notify();
}

function trySilentLegacy() {
  if (!legacy || stdPhantom() || client.wallet.getState().connected || legacyOwner) return;
  legacy
    .connect({ onlyIfTrusted: true })
    .then((r) => {
      if (stdPhantom() || client.wallet.getState().connected) return;
      legacyOwner = String(r.publicKey);
      notify();
    })
    .catch(() => {});
}

// Phantom injects its provider shortly after load on some platforms.
if (typeof window !== 'undefined') {
  client.wallet.subscribe(notify);
  const p = getPhantom();
  if (p) attachLegacy(p);
  const poll = setInterval(() => {
    const q = getPhantom();
    if (q) {
      attachLegacy(q);
      clearInterval(poll);
    }
  }, 250);
  setTimeout(() => {
    clearInterval(poll);
    graceOver = true;
    void client.wallet.whenReady().then(trySilentLegacy);
  }, LEGACY_GRACE_MS);
  void client.wallet.whenReady().then(() => {
    if (graceOver) trySilentLegacy();
    notify();
  });
  notify();
}

export function subscribeWallet(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getWalletSnapshot = (): WalletSnapshot => snapshot;

export async function connectWallet(name: string): Promise<void> {
  if (!SUPPORTED.has(name)) throw new WalletError('unsupported', `${name} is not tested with ZecDoor yet.`);
  const std = client.wallet.getState().wallets.find((w) => w.name === name);
  try {
    if (std) {
      await client.wallet.connect(std);
      legacyOwner = null;
    } else if (legacy && name === 'Phantom') {
      legacyConnecting = true;
      notify();
      const r = await legacy.connect();
      legacyOwner = String(r.publicKey);
    } else {
      throw new WalletError('not_connected', `${name} was not found in this browser.`);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    throw toWalletError(e, name);
  } finally {
    legacyConnecting = false;
    notify();
  }
}

export async function disconnectWallet(): Promise<void> {
  if (legacyOwner) {
    legacyOwner = null;
    await legacy?.disconnect().catch(() => {});
  } else {
    await client.wallet.disconnect().catch(() => {});
  }
  notify();
}

/**
 * Hands the transaction to the connected wallet with `solana:signAndSendTransaction` (or Phantom's
 * own signAndSendTransaction on the fallback path) and returns the base58 signature. Refuses if the
 * wallet is now on a different account than the one the transaction was built for.
 */
export async function signAndSend(tx: VersionedTransaction, expectedOwner: string): Promise<string> {
  const name = snapshot.connected?.name ?? 'Your wallet';
  if (legacyOwner && legacy) {
    const now = legacy.publicKey ? String(legacy.publicKey) : legacyOwner;
    if (now !== expectedOwner) throw new WalletError('account_changed', `${name} switched accounts before signing. Nothing was sent.`);
    try {
      return (await legacy.signAndSendTransaction(tx)).signature;
    } catch (e) {
      throw toWalletError(e, name);
    }
  }
  const c = client.wallet.getState().connected;
  if (!c) throw new WalletError('not_connected', 'No wallet is connected. Nothing was sent.');
  if (c.account.address !== expectedOwner) throw new WalletError('account_changed', `${name} switched accounts before signing. Nothing was sent.`);
  const signer = c.signer as unknown as { signAndSendTransactions?: (t: unknown[]) => Promise<readonly Uint8Array[]> } | null;
  if (!signer?.signAndSendTransactions || !c.supportedTransactionVersions.has(0)) {
    throw new WalletError('unsupported', `${name} cannot send this kind of transaction. Nothing was sent.`);
  }
  try {
    const [sig] = await signer.signAndSendTransactions([getTransactionDecoder().decode(tx.serialize())]);
    return getBase58Decoder().decode(sig!);
  } catch (e) {
    throw toWalletError(e, name);
  }
}

function toWalletError(e: unknown, name: string): WalletError {
  if (e instanceof WalletError) return e;
  const code = (e as { code?: number })?.code;
  const msg = String((e as Error)?.message ?? e);
  if (code === 4001 || /reject|cancel|denied|declined/i.test(msg)) return new WalletError('cancelled', `You cancelled in ${name}. Nothing was sent.`);
  if (code === -32002 || /already pending|request.*pending/i.test(msg)) return new WalletError('busy', `${name} already has a request open. Finish or close it there first.`);
  return new WalletError('failed', `${name} reported: ${msg}`);
}
