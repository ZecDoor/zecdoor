// End-to-end on a private regtest chain (no real funds):
//   zebrad (NU6.3 from height 1) + zainod + zcash-devtool (built with `regtest_support`).
// 1. A miner wallet (seed made by our WASM) mines coinbase into Ironwood.
// 2. Our WASM makes a user wallet and an Orchard-only address at diversifier index 4242.
// 3. The miner pays 1.23 to that address with zcash-devtool.
// 4. Our scanner finds the note in compact blocks served by zainod.
// 5. zcash-devtool restores the user's 24 words (same engine as Zodl's SDK) and sees 1.23.
//
// Run: REGTEST=1 ZEBRAD=… ZAINOD=… DEVTOOL=… pnpm --filter @zecdoor/zcash test regtest
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeBlockRange, type BlockSource } from '../src/lightwalletd.js';
import { addressAt, loadZcashWasm, newWallet, scanRange, type Found } from '../src/wallet.js';

const enabled = process.env.REGTEST === '1';
const suite = enabled ? describe : describe.skip;

const ZEBRAD = process.env.ZEBRAD ?? '';
const ZAINOD = process.env.ZAINOD ?? '';
const DEVTOOL = process.env.DEVTOOL ?? '';
const RPC = 18432;
const P2P = 18444;
const GRPC = 8237;
const SERVER = `localhost:${GRPC}`;

const dir = enabled ? mkdtempSync(join(tmpdir(), 'zecdoor-regtest-')) : '';
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${RPC}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

function devtool(walletDir: string, args: string[], input?: string): string {
  return execFileSync(DEVTOOL, ['wallet', '-w', walletDir, ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 240_000,
  });
}

function nodeGrpcSource(): BlockSource {
  const id = (x: Buffer) => x;
  const Client = grpc.makeGenericClientConstructor({
    GetLatestBlock: {
      path: '/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock',
      requestStream: false, responseStream: false,
      requestSerialize: id, requestDeserialize: id, responseSerialize: id, responseDeserialize: id,
    },
    GetBlockRange: {
      path: '/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange',
      requestStream: false, responseStream: true,
      requestSerialize: id, requestDeserialize: id, responseSerialize: id, responseDeserialize: id,
    },
  }, 'CompactTxStreamer');
  const c = new Client(`127.0.0.1:${GRPC}`, grpc.credentials.createInsecure()) as unknown as {
    GetLatestBlock: (req: Buffer, cb: (e: Error | null, r: Buffer) => void) => void;
    GetBlockRange: (req: Buffer) => NodeJS.ReadableStream;
  };
  return {
    latestHeight: () =>
      new Promise((res, rej) =>
        c.GetLatestBlock(Buffer.alloc(0), (e, r) => (e ? rej(e) : res(Number(r[1])))),
      ),
    async *blocks(start, end) {
      for await (const b of c.GetBlockRange(Buffer.from(encodeBlockRange(start, end)))) yield new Uint8Array(b as Buffer);
    },
  };
}

async function waitFor(what: string, f: () => Promise<boolean>, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await f()) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const HEIGHTS = ['overwinter', 'sapling', 'blossom', 'heartwood', 'canopy', 'nu5', 'nu6', 'nu6_1', 'nu6_2', 'nu6_3']
  .map((k) => `${k} = 1`)
  .join('\n');

suite('regtest end-to-end', () => {
  let miner: { mnemonic: string; ufvk: string };
  let user: { mnemonic: string; ufvk: string; birthday: number };
  let userAddress = '';
  let found: Found[] = [];
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    for (const [k, v] of Object.entries({ ZEBRAD, ZAINOD, DEVTOOL })) if (!v) throw new Error(`set ${k}`);
    await loadZcashWasm(
      readFileSync(fileURLToPath(new URL('../../../crates/zecdoor-wasm/pkg/zecdoor_wasm_bg.wasm', import.meta.url))),
    );
    miner = newWallet('regtest', 1);
    const minerAddress = addressAt(miner.ufvk, 'regtest', 0);
    writeFileSync(join(dir, 'heights.toml'), HEIGHTS + '\n');
    writeFileSync(
      join(dir, 'zebrad.toml'),
      `[mining]\nminer_address = "${minerAddress}"\n\n[network]\nnetwork = "Regtest"\nlisten_addr = "127.0.0.1:${P2P}"\n\n` +
        `[network.testnet_parameters.activation_heights]\nCanopy = 1\nNU5 = 1\nNU6 = 1\n"NU6.1" = 1\n"NU6.2" = 1\n"NU6.3" = 1\n\n` +
        `[state]\nephemeral = true\ncache_dir = "${join(dir, 'zebra')}"\n\n[rpc]\nlisten_addr = "127.0.0.1:${RPC}"\nenable_cookie_auth = false\n`,
    );
    procs.push(spawn(ZEBRAD, ['-c', join(dir, 'zebrad.toml'), 'start'], { stdio: 'ignore' }));
    await waitFor('zebrad', async () => (await rpc('getblockcount')) !== undefined);
    await rpc('generate', [110]);

    writeFileSync(
      join(dir, 'zainod.toml'),
      `backend = "rpc"\nzebra_db_path = "${join(dir, 'zebra')}"\nephemeral_finalised_state = true\nnetwork = "Regtest"\n\n` +
        `[grpc_settings]\nlisten_address = "127.0.0.1:${GRPC}"\n\n[validator_settings]\n` +
        `validator_jsonrpc_listen_address = "127.0.0.1:${RPC}"\nvalidator_user = "x"\nvalidator_password = "x"\n\n` +
        `[storage.database]\npath = "${join(dir, 'zaino-db')}"\n`,
    );
    procs.push(spawn(ZAINOD, ['start', '-c', join(dir, 'zainod.toml')], { stdio: 'ignore' }));
    const src = nodeGrpcSource();
    await waitFor('zainod', async () => (await src.latestHeight()) >= 110);
  }, 300_000);

  afterAll(() => {
    for (const p of procs) p.kill('SIGTERM');
    if (enabled) writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  });

  it('pays our index-4242 address and our scanner finds the Ironwood note', async () => {
    const minerDir = join(dir, 'miner');
    const restore = ['-i', join(dir, 'id.age'), '-n', 'regtest', '--activation-heights', join(dir, 'heights.toml'), '-s', SERVER];
    devtool(minerDir, ['restore-mnemonic', '--name', 'miner', '--birthday', '1', ...restore], miner.mnemonic + '\n');
    devtool(minerDir, ['sync', '-s', SERVER]);
    const minerAccount = /Account ([0-9a-f-]{36})/.exec(devtool(minerDir, ['list-accounts']))?.[1];
    expect(minerAccount).toBeTruthy();

    const tip = await nodeGrpcSource().latestHeight();
    user = newWallet('regtest', tip);
    userAddress = addressAt(user.ufvk, 'regtest', 4242);
    devtool(minerDir, [
      'send', minerAccount!, '-i', join(dir, 'id.age'), '--address', userAddress,
      '--value', '123000000', '--memo', 'zecdoor regtest e2e', '-s', SERVER,
    ]);
    await rpc('generate', [1]);
    const src = nodeGrpcSource();
    await waitFor('the payment block', async () => (await src.latestHeight()) >= tip + 1);

    found = await scanRange({ ufvk: user.ufvk, network: 'regtest', source: src, from: user.birthday, to: tip + 1 });
    report.found = found;
    report.userAddress = userAddress;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ pool: 'ironwood', value: 123000000, scope: 'external', index: 4242 });
  }, 300_000);

  it('the same 24 words restore in zcash-devtool (Zodl\'s engine) with the funds', async () => {
    await rpc('generate', [10]);
    const src = nodeGrpcSource();
    const tip = await src.latestHeight();
    await waitFor('confirmations', async () => (await src.latestHeight()) >= tip);
    const userDir = join(dir, 'user');
    devtool(
      userDir,
      ['restore-mnemonic', '--name', 'user', '--birthday', String(user.birthday), '-i', join(dir, 'id-user.age'),
        '-n', 'regtest', '--activation-heights', join(dir, 'heights.toml'), '-s', SERVER],
      user.mnemonic + '\n',
    );
    devtool(userDir, ['sync', '-s', SERVER]);
    const balance = devtool(userDir, ['balance']);
    report.devtoolBalance = balance;
    expect(balance).toMatch(/1\.23/);
  }, 300_000);
});
