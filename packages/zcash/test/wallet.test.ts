import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GrpcWebSource,
  MAINNET_GRPC_WEB,
  addressAt,
  inspectAddress,
  isValidMnemonic,
  loadZcashWasm,
  newWallet,
  scanRange,
  ufvkFromMnemonic,
} from '../src/index.js';

const wasmPath = fileURLToPath(new URL('../../../crates/zecdoor-wasm/pkg/zecdoor_wasm_bg.wasm', import.meta.url));

beforeAll(async () => {
  await loadZcashWasm(readFileSync(wasmPath));
});

describe('wallet (WASM)', () => {
  it('makes a 24-word wallet whose viewing key re-derives from the words', () => {
    const w = newWallet('main', 3_506_377);
    expect(w.mnemonic.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(w.mnemonic)).toBe(true);
    expect(w.ufvk.startsWith('uview1')).toBe(true);
    expect(ufvkFromMnemonic(w.mnemonic, 'main')).toBe(w.ufvk);
  });

  it('gives a different Orchard-only address for every index', () => {
    const { ufvk } = newWallet('main', 0);
    const seen = new Set<string>();
    for (const i of [0, 1, 2, 4242, 2 ** 31]) {
      const a = addressAt(ufvk, 'main', i);
      expect(seen.has(a)).toBe(false);
      seen.add(a);
      const ins = inspectAddress(a, 'main');
      expect(ins).toMatchObject({ kind: 'unified', ok: true, receivers: ['orchard'] });
    }
  });

  it('explains why an address is refused', () => {
    // From the ZIP 316 vectors: p2pkh + sapling, no Orchard.
    const noOrchard =
      'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf';
    expect(inspectAddress(noOrchard, 'main').reason).toBe('no_orchard_receiver');
    expect(inspectAddress('t1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdgW', 'main').kind).toBe('transparent');
    expect(inspectAddress('nonsense', 'main').reason).toBe('invalid');
  });
});

const network = process.env.NETWORK_TESTS === '1' ? describe : describe.skip;

network('mainnet, read-only (NETWORK_TESTS=1)', () => {
  it('scans recent mainnet blocks through the public gRPC-web proxy', async () => {
    const source = new GrpcWebSource(MAINNET_GRPC_WEB);
    const tip = await source.latestHeight();
    expect(tip).toBeGreaterThan(3_500_000);
    const { ufvk } = newWallet('main', tip);
    const t0 = Date.now();
    const found = await scanRange({ ufvk, network: 'main', source, from: tip - 49, to: tip });
    expect(found).toEqual([]);
    console.log(`scanned 50 mainnet blocks ending at ${tip} in ${Date.now() - t0} ms`);
  }, 60_000);
});
