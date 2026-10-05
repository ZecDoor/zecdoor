// Our own server. It only answers questions; it never sees keys and never stores addresses.
// When it is unreachable the app keeps working (1Click is called directly), as planned in
// BUILD-PLAN §2.2: the health check only blocks moves together with a failing dry quote.

import { API } from '../config';

export interface Health {
  ok: boolean;
  /** NEAR Intents reports an open incident touching 1Click, Solana or Zcash. */
  paused: boolean;
  message?: string;
  /** Last fee self-test per move kind; false means that kind is not offered until reviewed. */
  fees?: Partial<Record<'exit' | 'buyUsdc' | 'buySol', boolean>>;
  checkedAt: string;
}

/** A move kind is offered unless the server's fee self-test failed for it. */
export const feeOk = (h: Health | null, kind: 'exit' | 'topup' | 'buyUsdc' | 'buySol') =>
  h?.fees?.[kind === 'topup' ? 'exit' : kind] !== false;

export interface Geo {
  allowed: boolean;
  /** Top-up uses Jupiter, which is not offered in some countries (decision D6). */
  topup: boolean;
  country?: string;
}

export interface Counter {
  moves: number;
  zecShieldedZat: string;
  firstWallets: number;
  smallBalances: number;
  refunded: number;
  medianSeconds: number | null;
  days: Array<{ day: string; exits: number; buys: number }>;
  updatedAt: string;
}

async function get<T>(path: string, timeoutMs = 6000): Promise<T | null> {
  try {
    const r = await fetch(API + path, { signal: AbortSignal.timeout(timeoutMs), credentials: 'omit' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const health = () => get<Health>('/health');
export const geo = () => get<Geo>('/geo');
export const counter = () => get<Counter>('/counter');

/** OFAC SDN Solana addresses, checked here in the browser so the wallet address is not sent. */
export async function isSanctioned(address: string): Promise<boolean> {
  const list = await get<{ solana: string[] }>('/sanctions');
  return !!list?.solana.includes(address);
}

/**
 * Asks the server to count a finished move. The server reads the move's status from 1Click
 * itself and counts it only if it succeeded and carries our fee; it keeps running totals and
 * a 24-hour duplicate check, not the address.
 */
export async function reportMove(depositAddress: string, kind: string, firstWallet: boolean): Promise<boolean> {
  try {
    const r = await fetch(API + '/count', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ depositAddress, kind, firstWallet }),
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
