// Web Worker that runs the arrival scan off the main thread. Single-threaded WASM: no
// SharedArrayBuffer needed (Android WebView inside Phantom has none).
//
// Message in:  { id, type: 'arrival', proxy, ufvk, network, from, to, index, minValue, txid? }
// Messages out: { id, type: 'progress', height } … then { id, type: 'result', found } or
//               { id, type: 'error', message }.

import { GrpcWebSource } from './lightwalletd.js';
import { findArrival, loadZcashWasm, type Found, type Network } from './wallet.js';

export interface ArrivalRequest {
  id: number;
  type: 'arrival';
  proxy: string;
  ufvk: string;
  network: Network;
  from: number;
  to: number;
  index: number;
  minValue: number;
  txid?: string;
}

export type WorkerReply =
  | { id: number; type: 'progress'; height: number }
  | { id: number; type: 'result'; found: Found | null }
  | { id: number; type: 'error'; message: string };

const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent<ArrivalRequest>) => void) | null;
  postMessage: (m: WorkerReply) => void;
};

ctx.onmessage = async (e) => {
  const r = e.data;
  try {
    await loadZcashWasm();
    const found = await findArrival({
      ufvk: r.ufvk,
      network: r.network,
      source: new GrpcWebSource(r.proxy),
      from: r.from,
      to: r.to,
      index: r.index,
      minValue: r.minValue,
      ...(r.txid ? { txid: r.txid } : {}),
      onProgress: (height) => ctx.postMessage({ id: r.id, type: 'progress', height }),
    });
    ctx.postMessage({ id: r.id, type: 'result', found });
  } catch (err) {
    ctx.postMessage({ id: r.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
