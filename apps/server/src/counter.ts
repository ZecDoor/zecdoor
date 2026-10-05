// The public counter. A page that built a move tells us its deposit address once the move
// ends; we read the result from 1Click ourselves and count it only if it is a ZecDoor move
// (our fee recipient in the signed quote's request) that succeeded or was refunded.
//
// Stored: per-day totals per route and a minute histogram of arrival times. Not stored: any
// address, transaction id, IP or device id. A salted hash of the deposit address is kept for
// 24 hours so the same move is not counted twice (1Click ToS §4.1(e): no API data kept beyond
// 24 hours; research p1-legal-rivals-names §A.5).

import { ASSET, FEE_RECIPIENT, ONE_CLICK_API, type StatusResponse } from '@zecdoor/solana';
import { getJson, type Env } from './env';

export interface Day {
  exits: number;
  topups: number;
  buys: number;
  firstWallets: number;
  refunded: number;
  /** Zatoshis delivered by counted moves. */
  zecZat: string;
  /** Minutes from quote to SUCCESS → count (last bucket = 60+). */
  minutes: Record<string, number>;
}

const empty = (): Day => ({ exits: 0, topups: 0, buys: 0, firstWallets: 0, refunded: 0, zecZat: '0', minutes: {} });
const DAY_TTL = 400 * 24 * 3600; // totals are kept; the explicit TTL just bounds stray keys

const ORIGINS = new Set<string>([ASSET.solanaZec, ASSET.solanaUsdc, ASSET.sol]);
const isDeposit = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type CountResult = { counted: boolean; reason?: string; status?: string };

export async function count(
  env: Env,
  fetchImpl: typeof fetch,
  body: { depositAddress?: unknown; kind?: unknown; firstWallet?: unknown },
  now = Date.now(),
): Promise<CountResult> {
  const dep = typeof body.depositAddress === 'string' ? body.depositAddress : '';
  if (!isDeposit(dep)) return { counted: false, reason: 'bad_request' };

  const key = `seen:${await sha256(env.HASH_SALT + ':' + dep)}`;
  if (await env.STATE.get(key)) return { counted: false, reason: 'already_counted' };

  const r = await fetchImpl(`${ONE_CLICK_API}/v0/status?depositAddress=${encodeURIComponent(dep)}`);
  if (!r.ok) return { counted: false, reason: 'unknown_move' };
  const s = (await r.json()) as StatusResponse;
  const req = s.quoteResponse?.quoteRequest;
  const ours = !!req?.appFees?.some((f) => f.recipient === FEE_RECIPIENT && f.fee > 0);
  if (!req || !ours || !ORIGINS.has(req.originAsset) || req.destinationAsset !== ASSET.zec) {
    return { counted: false, reason: 'not_zecdoor' };
  }
  if (s.status !== 'SUCCESS' && s.status !== 'REFUNDED') return { counted: false, reason: 'not_final', status: s.status };
  // The duplicate check lasts 24 hours, so only moves that ended within 24 hours count:
  // together they make each move countable once.
  const ended = Date.parse(s.updatedAt);
  if (!Number.isFinite(ended) || now - ended > 24 * 3600_000) return { counted: false, reason: 'too_old' };

  // Route comes from the signed request; the page's own claim is only used to tell a top-up
  // (same request as an exit) from an exit, and a first wallet from a later one.
  const zecIn = req.originAsset === ASSET.solanaZec;
  const route = !zecIn ? 'buys' : body.kind === 'topup' ? 'topups' : 'exits';
  const dayKey = `day:${new Date(now).toISOString().slice(0, 10)}`;
  const d = (await getJson<Day>(env.STATE, dayKey)) ?? empty();

  if (s.status === 'REFUNDED') d.refunded++;
  else {
    d[route]++;
    if (body.firstWallet === true) d.firstWallets++;
    const out = s.swapDetails?.amountOut ?? s.quoteResponse?.quote.amountOut ?? '0';
    d.zecZat = (BigInt(d.zecZat) + BigInt(out)).toString();
    const started = Date.parse(s.quoteResponse?.timestamp ?? '');
    if (Number.isFinite(started) && ended >= started) {
      const m = String(Math.min(60, Math.round((ended - started) / 60_000)));
      d.minutes[m] = (d.minutes[m] ?? 0) + 1;
    }
  }
  // KV has no atomic increment: two moves finishing in the same instant can lose one count
  // (an undercount, never an overcount). Acceptable at launch volumes.
  await env.STATE.put(dayKey, JSON.stringify(d), { expirationTtl: DAY_TTL });
  await env.STATE.put(key, '1', { expirationTtl: 24 * 3600 });
  return { counted: true, status: s.status };
}

export interface CounterAnswer {
  moves: number;
  zecShieldedZat: string;
  firstWallets: number;
  smallBalances: number;
  refunded: number;
  medianSeconds: number | null;
  days: Array<{ day: string; exits: number; buys: number }>;
  updatedAt: string;
}

export async function counter(env: Env, now = Date.now()): Promise<CounterAnswer> {
  const cached = await getJson<CounterAnswer & { at: number }>(env.STATE, 'cache:counter');
  if (cached && now - cached.at < 60_000) {
    const { at: _at, ...rest } = cached;
    return rest;
  }
  const days: Array<[string, Day]> = [];
  let cursor: string | undefined;
  do {
    const page = await env.STATE.list({ prefix: 'day:', ...(cursor ? { cursor } : {}) });
    for (const k of page.keys) {
      const d = await getJson<Day>(env.STATE, k.name);
      if (d) days.push([k.name.slice(4), d]);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  days.sort(([a], [b]) => a.localeCompare(b));

  const hist: Record<string, number> = {};
  let moves = 0;
  let zat = 0n;
  let first = 0;
  let small = 0;
  let refunded = 0;
  for (const [, d] of days) {
    moves += d.exits + d.topups + d.buys;
    zat += BigInt(d.zecZat);
    first += d.firstWallets;
    small += d.topups;
    refunded += d.refunded;
    for (const [m, n] of Object.entries(d.minutes)) hist[m] = (hist[m] ?? 0) + n;
  }
  const answer: CounterAnswer = {
    moves,
    zecShieldedZat: zat.toString(),
    firstWallets: first,
    smallBalances: small,
    refunded,
    medianSeconds: median(hist),
    days: days.slice(-30).map(([day, d]) => ({ day, exits: d.exits + d.topups, buys: d.buys })),
    updatedAt: new Date(now).toISOString(),
  };
  await env.STATE.put('cache:counter', JSON.stringify({ ...answer, at: now }), { expirationTtl: 300 });
  return answer;
}

/** Median of a minute histogram, in seconds; null with no data. */
export function median(hist: Record<string, number>): number | null {
  const entries = Object.entries(hist)
    .map(([m, n]) => [Number(m), n] as const)
    .sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  let seen = 0;
  for (const [m, n] of entries) {
    seen += n;
    if (seen * 2 >= total) return m * 60;
  }
  return null;
}
