import { describe, expect, it } from 'vitest';
import { FEE_RECIPIENT, type StatusResponse } from '@zecdoor/solana';
import { count, counter, median } from '../src/counter';
import type { Env, Store } from '../src/env';
import { decide } from '../src/geo';
import { health, relevantIncidents } from '../src/health';
import { handle, runFeeCheck } from '../src/index';
import { refreshSanctions } from '../src/sanctions';
import openPosts from './fixtures/status_posts_open.json';
import snarkstr from './fixtures/oneclick_status_snarkstr.json';
import zodl from './fixtures/oneclick_status_zodl.json';

class MemoryStore implements Store {
  data = new Map<string, { v: string; exp?: number }>();
  now = () => Date.now();
  async get(k: string) {
    const e = this.data.get(k);
    if (!e || (e.exp && e.exp < this.now())) return null;
    return e.v;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.data.set(k, { v, ...(o?.expirationTtl ? { exp: this.now() + o.expirationTtl * 1000 } : {}) });
  }
  async delete(k: string) {
    this.data.delete(k);
  }
  async list({ prefix }: { prefix: string }) {
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
  dump() {
    return [...this.data.entries()].map(([k, e]) => k + '=' + e.v).join('\n');
  }
}

const env = (): Env & { STATE: MemoryStore } => ({
  STATE: new MemoryStore(),
  HASH_SALT: 'test-salt',
  FEE_TEST_RECIPIENT: 'u1test',
  FEE_TEST_REFUND: '3QFJWVEk6tpf52gtk3saAP1nkuci6GRMNHx72etsi67T',
});

const respond = (routes: Record<string, unknown | ((u: string) => Response)>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    for (const [prefix, r] of Object.entries(routes)) {
      if (u.startsWith(prefix)) return typeof r === 'function' ? (r as (u: string) => Response)(u) : new Response(JSON.stringify(r));
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

// --------------------------------------------------------------------------- geo

describe('geo', () => {
  it.each([
    ['DE', undefined, true, true],
    ['GB', undefined, true, true],
    ['US', undefined, true, false], // no top-up (D6)
    ['SG', undefined, true, false],
    ['IR', undefined, false, false],
    ['RU', undefined, false, false],
    ['KP', undefined, false, false],
    ['UA', '43', false, false], // Crimea
    ['UA', 'UA-14', false, false], // Donetsk
    ['UA', '30', true, true], // Kyiv
    ['XX', undefined, true, true],
    [undefined, undefined, true, true],
  ])('%s %s → allowed %s, top-up %s', (c, r, allowed, topup) => {
    const d = decide(c, r);
    expect(d.allowed).toBe(allowed);
    expect(d.topup).toBe(topup);
  });
});

// --------------------------------------------------------------------------- health

describe('health', () => {
  const OCT5 = Date.parse('2026-10-05T03:00:00Z');
  const post = openPosts.posts[0]!;

  it('the open 1 Oct "1Click API Incident" does not block on 5 Oct (older than 24 h)', async () => {
    const h = await health(env(), respond({ 'https://status.near-intents.org/api/posts': openPosts }), OCT5);
    expect(h).toMatchObject({ ok: true, paused: false, incidents: [], statusPageReachable: true });
  });

  it('the same incident pauses moves while it is fresh', async () => {
    const at = post.last_update_at + 3600_000;
    const h = await health(env(), respond({ 'https://status.near-intents.org/api/posts': openPosts }), at);
    expect(h.paused).toBe(true);
    expect(h.message).toBe('NEAR Intents reports: 1Click API Incident.');
    expect(h.incidents[0]!.services).toEqual(['1Click Swap']);
  });

  it('incidents on unrelated services do not pause', () => {
    const p = { ...post, title: 'Bitcoin delays', latest_update: { impacts: [{ service_id: 'PV0VCGU' }] }, updates: [] };
    expect(relevantIncidents([p], post.last_update_at + 1000)).toEqual([]);
  });

  it('manual override: on pauses, off ignores incidents', async () => {
    const e = env();
    await e.STATE.put('override:paused', 'on');
    expect((await health(e, respond({ 'https://status.near-intents.org/api/posts': { posts: [] } }), OCT5)).paused).toBe(true);
    const f = env();
    await f.STATE.put('override:paused', 'off');
    expect((await health(f, respond({ 'https://status.near-intents.org/api/posts': openPosts }), post.last_update_at + 1000)).paused).toBe(false);
  });

  it('an unreachable status page does not block on its own', async () => {
    const h = await health(env(), respond({}), OCT5);
    expect(h).toMatchObject({ paused: false, statusPageReachable: false });
  });

  it('reports the last fee self-test per move kind', async () => {
    const e = env();
    await e.STATE.put('feecheck', JSON.stringify({ at: '2026-10-05T02:30:00Z', checks: [{ kind: 'exit', ok: true }, { kind: 'buyUsdc', ok: false }] }));
    const h = await health(e, respond({ 'https://status.near-intents.org/api/posts': { posts: [] } }), OCT5);
    expect(h.fees).toEqual({ exit: true, buyUsdc: false });
  });
});

// --------------------------------------------------------------------------- counter

const ours = (s: unknown, patch: Partial<StatusResponse> = {}): StatusResponse => {
  const c = JSON.parse(JSON.stringify(s)) as StatusResponse;
  c.quoteResponse!.quoteRequest.appFees = [{ recipient: FEE_RECIPIENT, fee: 25 }];
  return { ...c, ...patch };
};

describe('count', () => {
  const dep = snarkstr.quoteResponse.quote.depositAddress;
  const when = (s: StatusResponse) => Date.parse(s.updatedAt) + 60_000;

  it('counts a finished ZecDoor move once, and stores no address', async () => {
    const e = env();
    const s = ours(snarkstr);
    const f = respond({ 'https://1click.chaindefuser.com/v0/status': s });
    expect(await count(e, f, { depositAddress: dep, kind: 'exit', firstWallet: true }, when(s))).toEqual({ counted: true, status: 'SUCCESS' });
    expect(await count(e, f, { depositAddress: dep, kind: 'exit' }, when(s))).toEqual({ counted: false, reason: 'already_counted' });

    const c = await counter(e, when(s));
    expect(c).toMatchObject({ moves: 1, firstWallets: 1, smallBalances: 0, refunded: 0 });
    expect(BigInt(c.zecShieldedZat)).toBeGreaterThan(0n);

    const dump = e.STATE.dump();
    for (const secret of [dep, s.quoteResponse!.quoteRequest.recipient, s.quoteResponse!.quoteRequest.refundTo, ...(s.swapDetails?.originChainTxHashes ?? []).map((h) => h.hash)]) {
      expect(dump).not.toContain(secret);
    }
  });

  it('top-ups count as small balances rescued', async () => {
    const e = env();
    const s = ours(snarkstr);
    await count(e, respond({ 'https://1click.chaindefuser.com/v0/status': s }), { depositAddress: dep, kind: 'topup' }, when(s));
    expect((await counter(e, when(s))).smallBalances).toBe(1);
  });

  it('does not count another app’s move (Zodl, real quote)', async () => {
    const r = await count(env(), respond({ 'https://1click.chaindefuser.com/v0/status': zodl }), { depositAddress: zodl.quoteResponse.quote.depositAddress }, Date.parse(zodl.updatedAt));
    expect(r).toEqual({ counted: false, reason: 'not_zecdoor' });
  });

  it('does not count unfinished, old or malformed reports', async () => {
    const p = ours(snarkstr, { status: 'PROCESSING' });
    expect(await count(env(), respond({ 'https://1click.chaindefuser.com/v0/status': p }), { depositAddress: dep }, when(p))).toMatchObject({ reason: 'not_final' });
    const s = ours(snarkstr);
    expect(await count(env(), respond({ 'https://1click.chaindefuser.com/v0/status': s }), { depositAddress: dep }, when(s) + 2 * 86400_000)).toMatchObject({ reason: 'too_old' });
    expect(await count(env(), respond({}), { depositAddress: '<script>' })).toMatchObject({ reason: 'bad_request' });
    expect(await count(env(), respond({}), { depositAddress: dep })).toMatchObject({ reason: 'unknown_move' });
  });

  it('counts refunds separately', async () => {
    const e = env();
    const s = ours(snarkstr, { status: 'REFUNDED' });
    await count(e, respond({ 'https://1click.chaindefuser.com/v0/status': s }), { depositAddress: dep }, when(s));
    expect(await counter(e, when(s))).toMatchObject({ moves: 0, refunded: 1 });
  });

  it('starts with real zeros, not invented numbers', async () => {
    expect(await counter(env())).toMatchObject({ moves: 0, zecShieldedZat: '0', medianSeconds: null, days: [] });
  });

  it('median of the minute histogram', () => {
    expect(median({ '3': 2, '5': 1, '9': 2 })).toBe(300);
    expect(median({})).toBeNull();
  });
});

// --------------------------------------------------------------------------- sanctions, fee check, routing

describe('sanctions', () => {
  it('keeps only well-formed Solana addresses', async () => {
    const e = env();
    const list = await refreshSanctions(e, (async () => new Response('42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi\n\nnot an address\n')) as unknown as typeof fetch);
    expect(list.solana).toEqual(['42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi']);
  });
});

describe('fee self-test', () => {
  it('stores pass/fail per kind from the echoed fee rows', async () => {
    const e = env();
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body));
      const zecIn = req.originAsset.startsWith('1cs_v1');
      const appFees = zecIn ? [{ recipient: FEE_RECIPIENT, fee: 25 }] : [{ recipient: FEE_RECIPIENT, fee: 25 }, { recipient: 'near', fee: 25 }];
      return new Response(JSON.stringify({ quoteRequest: { ...req, appFees }, quote: {}, signature: '', timestamp: '' }));
    }) as typeof fetch;
    const checks = await runFeeCheck(e, f);
    expect(checks.map((c) => [c.kind, c.ok])).toEqual([['exit', true], ['buyUsdc', true], ['buySol', true]]);
    expect(JSON.parse((await e.STATE.get('feecheck'))!).checks).toHaveLength(3);
  });
});

describe('routing', () => {
  it('answers geo from Cloudflare’s request data', async () => {
    const req = Object.assign(new Request('https://x/api/geo'), { cf: { country: 'US' } });
    expect(await (await handle(req, env())).json()).toEqual({ allowed: true, topup: false, country: 'US' });
  });
  it('sends everything outside /api to the static site', async () => {
    const e = { ...env(), ASSETS: { fetch: async () => new Response('site') } };
    expect(await (await handle(new Request('https://x/app/'), e)).text()).toBe('site');
  });
  it('plain http is sent to https, path and query kept', async () => {
    const r = await handle(new Request('http://zecdoor.0xo.in/docs/fees?x=1'), env());
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://zecdoor.0xo.in/docs/fees?x=1');
  });
  it('unknown API paths are 404, oversized count bodies 413', async () => {
    expect((await handle(new Request('https://x/api/nope'), env())).status).toBe(404);
    const big = new Request('https://x/api/count', { method: 'POST', body: 'x'.repeat(2000), headers: { 'content-length': '2000' } });
    expect((await handle(big, env())).status).toBe(413);
  });
});
