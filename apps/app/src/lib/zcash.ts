// Zcash side of the app: the in-browser wallet (new seed, viewing key, fresh addresses),
// destination checks, and the arrival scan against lightwalletd over gRPC-web.

import {
  addressAt,
  addressOwner,
  GrpcWebSource,
  inspectAddress,
  loadZcashWasm,
  newWallet,
  type ArrivalRequest,
  type Found,
  type Inspection,
  type Ownership,
  type WorkerReply,
} from '@zecdoor/zcash';
import { LIGHTWALLETD } from '../config';

const NET = 'main' as const;

/** Test-only seam, compiled out of production builds (VITE_E2E is unset there). */
type E2E = { latestHeight?: () => Promise<number>; arrival?: (r: ArrivalRequest) => Promise<Found | null> };
const e2e = (): E2E | undefined =>
  import.meta.env.VITE_E2E === '1' ? (window as unknown as { __ZECDOOR_E2E__?: E2E }).__ZECDOOR_E2E__ : undefined;

let loaded: Promise<void> | null = null;
export const ready = () => (loaded ??= loadZcashWasm());

export async function latestHeight(): Promise<number> {
  const t = e2e()?.latestHeight;
  if (t) return t();
  return new GrpcWebSource(LIGHTWALLETD).latestHeight(AbortSignal.timeout(15_000));
}

export async function createWallet() {
  await ready();
  const tip = await latestHeight();
  // The wallet cannot have received anything before it existed; a few blocks of margin.
  return newWallet(NET, tip - 10);
}

export async function freshAddress(ufvk: string, index: number): Promise<string> {
  await ready();
  return addressAt(ufvk, NET, index);
}

export async function inspect(address: string): Promise<Inspection> {
  await ready();
  return inspectAddress(address.trim(), NET);
}

/** Whether an address (from Zodl's Receive screen, say) belongs to this browser's wallet. */
export async function ownedBy(ufvk: string, address: string): Promise<Ownership> {
  await ready();
  return addressOwner(ufvk, NET, address.trim());
}

export const ADDRESS_PROBLEMS: Record<Inspection['reason'], string> = {
  ok: '',
  invalid: 'This is not a Zcash address. Check for a missing or extra character.',
  wrong_network: 'This is a testnet address. Use a mainnet address.',
  no_orchard_receiver: 'This unified address has no shielded (Orchard) receiver, so the bridge cannot pay it.',
  sapling_address: 'Sapling-only address (zs1…): the bridge can’t pay it. Use a unified address (u1…).',
  transparent_address: 'Transparent address (t1…): not private. Use a shielded unified address (u1…).',
  tex_address: 'TEX address: transparent only. Use a shielded unified address (u1…).',
  sprout_address: 'Sprout address: retired. Use a current wallet’s unified address (u1…).',
};

let worker: Worker | null = null;
let seq = 0;

/** Scans `from..=to` for the note paid to `index`. Resolves null when it is not there yet. */
export function scanForArrival(o: Omit<ArrivalRequest, 'id' | 'type' | 'proxy' | 'network'>, onProgress?: (h: number) => void): Promise<Found | null> {
  const req: ArrivalRequest = { ...o, id: ++seq, type: 'arrival', proxy: LIGHTWALLETD, network: NET };
  const t = e2e()?.arrival;
  if (t) return t(req);
  worker ??= new Worker(new URL('./arrival.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.id !== req.id) return;
      if (m.type === 'progress') onProgress?.(m.height);
      else {
        w.removeEventListener('message', on);
        if (m.type === 'result') resolve(m.found);
        else reject(new Error(m.message));
      }
    };
    w.addEventListener('message', on);
    w.postMessage(req);
  });
}
