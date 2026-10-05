// Is NEAR Intents usable right now? Read from its public status page (PagerDuty), which has
// no CORS headers, so the browser cannot ask it directly. Cached for 60 seconds.

import { getJson, type Env } from './env';
import type { FeeCheck } from '@zecdoor/solana';

export const STATUS_API = 'https://status.near-intents.org/api';
/** Posts in the open ("detected") state, as used by the status page itself. */
const OPEN = 'PP34365';

/** Services whose incidents stop ZecDoor (ids from /api/services, 5 Oct 2026). */
export const RELEVANT_SERVICES: Record<string, string> = {
  PTEURIB: '1Click Swap',
  PXQFSY1: 'Cross-Chain Bridging',
  PYFS8RW: 'Passive Deposit/Withdrawal Service',
  PLT88AT: 'Solvers Network',
  PYZGDVH: 'Solana Blockchain',
  PNEJBRE: 'Other Blockchains',
};

/**
 * Only incidents updated in the last 24 hours count: an incident left open for days with no
 * updates (the "1Click API Incident" opened 1 Oct 2026 is still open on 5 Oct) would otherwise
 * block every move. A manual override covers what this rule gets wrong (research p1-oneclick §A.5 #11).
 */
export const RECENT_MS = 24 * 3600_000;

interface Post {
  title: string;
  last_update_at: number;
  ends_at: number | null;
  updates?: Array<{ impacts?: Array<{ service_id: string }> }>;
  latest_update?: { impacts?: Array<{ service_id: string }> };
}

export interface Incident {
  title: string;
  at: string;
  services: string[];
}

export function relevantIncidents(posts: Post[], now: number): Incident[] {
  return posts
    .filter((p) => !p.ends_at && now - p.last_update_at < RECENT_MS)
    .map((p) => {
      const ids = new Set([...(p.latest_update?.impacts ?? []), ...(p.updates ?? []).flatMap((u) => u.impacts ?? [])].map((i) => i.service_id));
      return { title: p.title, at: new Date(p.last_update_at).toISOString(), services: [...ids].filter((id) => id in RELEVANT_SERVICES).map((id) => RELEVANT_SERVICES[id]!) };
    })
    .filter((i) => i.services.length > 0 || /zec|zcash|solana|1click|paused?/i.test(i.title));
}

export interface HealthAnswer {
  ok: boolean;
  paused: boolean;
  message?: string;
  incidents: Incident[];
  /** Fee rows per move kind from the last self-test; a failed kind is not offered. */
  fees: Partial<Record<FeeCheck['kind'], boolean>>;
  feesCheckedAt?: string;
  statusPageReachable: boolean;
  checkedAt: string;
}

export async function health(env: Env, fetchImpl: typeof fetch, now = Date.now()): Promise<HealthAnswer> {
  const cached = await getJson<HealthAnswer & { at: number }>(env.STATE, 'cache:health');
  if (cached && now - cached.at < 60_000) {
    const { at: _at, ...rest } = cached;
    return rest;
  }

  let incidents: Incident[] = [];
  let reachable = true;
  try {
    const r = await fetchImpl(`${STATUS_API}/posts?statuses%5B%5D=${OPEN}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    incidents = relevantIncidents(((await r.json()) as { posts: Post[] }).posts ?? [], now);
  } catch {
    reachable = false; // don't block on the status page alone (BUILD-PLAN §2.2)
  }

  const override = await env.STATE.get('override:paused'); // 'on' forces a pause, 'off' ignores incidents
  const fee = await getJson<{ at: string; checks: FeeCheck[] }>(env.STATE, 'feecheck');
  const fees = Object.fromEntries((fee?.checks ?? []).map((c) => [c.kind, c.ok]));
  const paused = override === 'on' || (override !== 'off' && incidents.length > 0);
  const answer: HealthAnswer = {
    ok: !paused,
    paused,
    ...(paused ? { message: incidents[0] ? `NEAR Intents reports: ${incidents[0].title}.` : 'Moves are paused while we check the bridge.' } : {}),
    incidents,
    fees,
    ...(fee ? { feesCheckedAt: fee.at } : {}),
    statusPageReachable: reachable,
    checkedAt: new Date(now).toISOString(),
  };
  await env.STATE.put('cache:health', JSON.stringify({ ...answer, at: now }), { expirationTtl: 300 });
  return answer;
}
