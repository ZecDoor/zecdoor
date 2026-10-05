// Phantom's injected Solana provider. ZecDoor uses only connect, disconnect and
// signAndSendTransaction: never signMessage, never signAllTransactions.

import type { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { APP_URL } from '../config';

export interface PhantomSolana {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: VersionedTransaction, opts?: { skipPreflight?: boolean }): Promise<{ signature: string }>;
  on(event: 'accountChanged' | 'disconnect' | 'connect', cb: (arg?: unknown) => void): void;
  off?(event: string, cb: (arg?: unknown) => void): void;
  removeListener?(event: string, cb: (arg?: unknown) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomSolana };
  }
}

export function getPhantom(): PhantomSolana | null {
  const p = window.phantom?.solana;
  return p?.isPhantom ? p : null;
}

/** Opens this page inside Phantom's in-app browser (docs.phantom.com, "browse" deeplink). */
export function phantomBrowseLink(url = APP_URL): string {
  const ref = new URL(url).origin;
  return `https://phantom.com/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
}

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** True when the user closed or rejected the Phantom prompt (EIP-1193 style code 4001). */
export const isUserRejection = (e: unknown) =>
  typeof e === 'object' && e !== null && ((e as { code?: number }).code === 4001 || /reject|cancel|denied/i.test(String((e as Error).message)));
