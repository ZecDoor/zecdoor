// Browser-side Zcash wallet functions: a new seed, view-only key, fresh addresses,
// destination checks and the arrival scan. Nothing here can spend: the seed is only
// turned into a viewing key and is never stored by this module.

import initWasm, * as wasm from 'zecdoor-wasm';
import type { BlockSource } from './lightwalletd.js';

export type Network = 'main' | 'test' | 'regtest';

export interface Inspection {
  kind: 'unified' | 'sapling' | 'transparent' | 'tex' | 'sprout' | 'invalid';
  network: Network | '';
  receivers: Array<'orchard' | 'sapling' | 'p2pkh' | 'p2sh' | 'unknown'>;
  ok: boolean;
  reason:
    | 'ok'
    | 'invalid'
    | 'wrong_network'
    | 'no_orchard_receiver'
    | 'sapling_address'
    | 'transparent_address'
    | 'tex_address'
    | 'sprout_address';
}

export interface Found {
  height: number;
  txid: string;
  pool: 'ironwood' | 'orchard';
  /** Zatoshis. */
  value: number;
  scope: 'external' | 'internal';
  /** Diversifier index of the receiving address (null if above 2^32). */
  index: number | null;
}

export interface NewWallet {
  /** 24 words. Show once for backup; never store. */
  mnemonic: string;
  /** Orchard-only unified full viewing key. Safe to keep on the device. */
  ufvk: string;
  /** Block height to give Zodl or Zkool on restore ("Wallet Birthday Height"). */
  birthday: number;
}

let ready: Promise<void> | null = null;

/** Loads the WASM module once. In Node tests, pass the .wasm bytes. */
export function loadZcashWasm(moduleOrPath?: BufferSource | URL | string): Promise<void> {
  ready ??= initWasm(moduleOrPath === undefined ? undefined : { module_or_path: moduleOrPath }).then(() => undefined);
  return ready;
}

export function newWallet(network: Network, birthday: number): NewWallet {
  const mnemonic = wasm.new_mnemonic();
  return { mnemonic, ufvk: wasm.ufvk_from_mnemonic(mnemonic, network), birthday };
}

export const isValidMnemonic = (phrase: string): boolean => wasm.is_valid_mnemonic(phrase);

export const ufvkFromMnemonic = (phrase: string, network: Network): string =>
  wasm.ufvk_from_mnemonic(phrase, network);

/** The Orchard-only unified address at diversifier `index`. Use a new index per move. */
export const addressAt = (ufvk: string, network: Network, index: number): string =>
  wasm.address_at(ufvk, network, index);

export const inspectAddress = (address: string, network: Network): Inspection =>
  JSON.parse(wasm.inspect_address(address, network)) as Inspection;

export interface ScanOptions {
  ufvk: string;
  network: Network;
  source: BlockSource;
  from: number;
  to: number;
  signal?: AbortSignal;
  onProgress?: (height: number) => void;
}

/** All notes paid to the viewing key in `from..=to`. */
export async function scanRange(o: ScanOptions): Promise<Found[]> {
  const scanner = new wasm.Scanner(o.ufvk, o.network);
  const found: Found[] = [];
  let seen = 0;
  try {
    for await (const block of o.source.blocks(o.from, o.to, o.signal)) {
      found.push(...(JSON.parse(scanner.scan(block)) as Found[]));
      seen++;
      if (o.onProgress && seen % 25 === 0) o.onProgress(o.from + seen - 1);
    }
    o.onProgress?.(o.to);
  } finally {
    scanner.free();
  }
  return found;
}

export interface ArrivalOptions extends ScanOptions {
  /** The diversifier index the move paid. */
  index: number;
  /** Minimum zatoshis expected (the quote's minimum output). */
  minValue: number;
  /** The Zcash txid from the bridge's status, when known. */
  txid?: string;
}

/** The note proving a move arrived, or null if it is not in the range yet. */
export async function findArrival(o: ArrivalOptions): Promise<Found | null> {
  const found = await scanRange(o);
  return (
    found.find(
      (f) =>
        f.scope === 'external' &&
        f.index === o.index &&
        f.value >= o.minValue &&
        (o.txid === undefined || f.txid === o.txid.toLowerCase()),
    ) ?? null
  );
}
