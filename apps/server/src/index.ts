// ZecDoor's server: a Cloudflare Worker. It answers questions and keeps totals only.
// It never receives keys, never builds or signs transactions, and stores no addresses.

import { feeSelfTest, OneClickClient } from '@zecdoor/solana';
import { count, counter } from './counter';
import { json, type Env } from './env';
import { decide } from './geo';
import { health } from './health';
import { refreshSanctions, sanctions } from './sanctions';

export { decide } from './geo';

async function runFeeCheck(env: Env, fetchImpl: typeof fetch, now = Date.now()) {
  const checks = await feeSelfTest({
    recipient: env.FEE_TEST_RECIPIENT,
    refundTo: env.FEE_TEST_REFUND,
    // Workers' fetch throws "Illegal invocation" when called as a method of another object.
    client: new OneClickClient(undefined, (...a: Parameters<typeof fetch>) => fetchImpl(...a)),
  });
  await env.STATE.put('feecheck', JSON.stringify({ at: new Date(now).toISOString(), checks }));
  return checks;
}

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
  }
  try {
    if (req.method === 'GET' && path === '/api/health') return json(await health(env, fetchImpl));
    if (req.method === 'GET' && path === '/api/geo') {
      const cf = (req as Request & { cf?: { country?: string; regionCode?: string } }).cf;
      return json(decide(cf?.country, cf?.regionCode));
    }
    if (req.method === 'GET' && path === '/api/sanctions') return json(await sanctions(env, fetchImpl), { maxAge: 3600 });
    if (req.method === 'GET' && path === '/api/counter') return json(await counter(env), { maxAge: 60 });
    if (req.method === 'POST' && path === '/api/count') {
      if (Number(req.headers.get('content-length') ?? 0) > 1024) return json({ counted: false, reason: 'too_large' }, { status: 413 });
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const r = await count(env, fetchImpl, body);
      return json(r, { status: r.reason === 'bad_request' ? 400 : 200 });
    }
    return json({ error: 'not_found' }, { status: 404 });
  } catch {
    return json({ error: 'unavailable' }, { status: 503 });
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  async scheduled(event: { cron: string }, env: Env) {
    // Every 30 minutes: fee self-test. Daily: sanctions list.
    if (event.cron === '17 3 * * *') await refreshSanctions(env, fetch);
    else await runFeeCheck(env, fetch);
  },
};

export { runFeeCheck };
