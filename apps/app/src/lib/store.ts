// Everything ZecDoor keeps lives in this browser's IndexedDB: the viewing key of a wallet
// made here (never the 24 words), the next address index, a list of hashed addresses used
// before, and this device's move history. Nothing here is sent anywhere.

import type { MoveKind, QuoteResponse, SwapStatus } from '@zecdoor/solana';

export interface BrowserWallet {
  /** Orchard-only unified full viewing key: can see, cannot spend. */
  ufvk: string;
  /** Wallet Birthday Height to give Zodl or Zkool on restore. */
  birthday: number;
  /** Diversifier index for the next move (one fresh address per move). */
  nextIndex: number;
  createdAt: number;
  /** Set until the first move into this wallet has been counted. */
  firstMovePending?: boolean;
}

export interface Arrival {
  height: number;
  txid: string;
  value: number;
  pool: 'ironwood' | 'orchard';
  foundAt: number;
  /** Whether the note's txid equals the one 1Click reported. */
  txidMatches?: boolean;
}

export interface MoveRecord {
  depositAddress: string;
  kind: MoveKind;
  createdAt: number;
  owner: string;
  /** Base units of the origin asset. */
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  withdrawFee?: string;
  recipient: string;
  /** Diversifier index when the recipient is this browser's wallet, else null. */
  recipientIndex: number | null;
  /** Zcash tip when the move was quoted: the arrival scan starts here. */
  zcashFrom: number | null;
  quote: QuoteResponse;
  /** Top-up / buy: what the user paid with. */
  paid?: { amount: string; symbol: 'SOL' | 'USDC' };
  status: SwapStatus;
  updatedAt: number;
  statusSince: number;
  solanaSignature?: string;
  zcashTxid?: string;
  refund?: { reason?: string; amount?: string; fee?: string; txid?: string };
  arrival?: Arrival;
  /** Highest Zcash block already scanned for the arrival. */
  scannedTo?: number;
  completedAt?: number;
  counted?: boolean;
  firstWallet?: boolean;
}

const DB = 'zecdoor';
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('moves')) d.createObjectStore('moves', { keyPath: 'depositAddress' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function req<T>(store: 'kv' | 'moves', mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const r = f(tx.objectStore(store));
        tx.oncomplete = () => resolve(r.result as T);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const getWallet = () => req<BrowserWallet | undefined>('kv', 'readonly', (s) => s.get('wallet'));
export const putWallet = (w: BrowserWallet) => req<void>('kv', 'readwrite', (s) => s.put(w, 'wallet'));
export const forgetWallet = () => req<void>('kv', 'readwrite', (s) => s.delete('wallet'));

export const getMove = (depositAddress: string) => req<MoveRecord | undefined>('moves', 'readonly', (s) => s.get(depositAddress));
export const putMove = (m: MoveRecord) => req<void>('moves', 'readwrite', (s) => s.put(m));
export const deleteMove = (depositAddress: string) => req<void>('moves', 'readwrite', (s) => s.delete(depositAddress));
export async function listMoves(): Promise<MoveRecord[]> {
  const all = await req<MoveRecord[]>('moves', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Remembers that a pasted address was used, as a hash, to warn on reuse. */
export async function markAddressUsed(address: string): Promise<void> {
  const used = (await req<string[] | undefined>('kv', 'readonly', (s) => s.get('used'))) ?? [];
  const h = await sha256(address);
  if (!used.includes(h)) await req<void>('kv', 'readwrite', (s) => s.put([...used, h], 'used'));
}

export async function wasAddressUsed(address: string): Promise<boolean> {
  const used = (await req<string[] | undefined>('kv', 'readonly', (s) => s.get('used'))) ?? [];
  return used.includes(await sha256(address));
}
