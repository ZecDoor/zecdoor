// Solana RPC with fallback across the configured public endpoints.

import { Connection } from '@solana/web3.js';
import { SOLANA_RPCS } from '../config';

const connections = SOLANA_RPCS.map((url) => new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true }));
let preferred = 0;

/** Runs `fn` on the preferred endpoint, then the others, until one answers. */
export async function withRpc<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < connections.length; i++) {
    const idx = (preferred + i) % connections.length;
    try {
      const r = await fn(connections[idx]!);
      preferred = idx;
      return r;
    } catch (e) {
      // Callers read accounts with calls that return null for "does not exist", so
      // anything thrown here is a transport or endpoint problem: try the next one.
      last = e;
    }
  }
  throw new RpcDown(last);
}

export class RpcDown extends Error {
  constructor(readonly cause: unknown) {
    super('Solana network is not answering. Try again in a minute.');
  }
}
