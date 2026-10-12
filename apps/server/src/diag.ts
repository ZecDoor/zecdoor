// TEMPORARY device diagnostics for the preview Worker only (DIAG=1 is set in wrangler.jsonc's preview env, never in
// production). Stores short app events for two days so a bug seen only in Phantom's in-app browser can be traced.
// Only whitelisted short fields are kept; addresses arrive cut to 6 characters by the app. Reading needs DIAG_KEY.
import { json, type Env } from './env';

const ADDRESS = new Set(['a', 'd6', 'conn', 'kitConn', 'legacy', 'pk', 'to', 'last']); // cut to 6 characters
const FIELDS = new Set(['b', 's', 'n', 't', 'e', 'h', 'ua', 'phantom', 'persisted', 'state', 'msg', 'ready', 'connecting', 'conn', 'via', 'kit', 'kitConn', 'legacy', 'pk', 'kind', 'amt', 'dest', 'd6', 'to', 'last', 'own', 'a', 'draftKind', 'kept', 'len', 'ok', 'canGo']);

export async function diagPost(req: Request, env: Env): Promise<Response> {
  if (Number(req.headers.get('content-length') ?? 0) > 2048) return json({ ok: false }, { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ ok: false }, { status: 400 });
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!FIELDS.has(k)) continue;
    if (typeof v === 'string') kept[k] = v.slice(0, ADDRESS.has(k) ? 6 : k === 'ua' ? 120 : 40);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) kept[k] = v;
  }
  const at = Date.now();
  await env.STATE.put(`diag:${String(at).padStart(15, '0')}:${Math.random().toString(16).slice(2, 8)}`, JSON.stringify({ ...kept, srv: at }), { expirationTtl: 2 * 86400 });
  return json({ ok: true });
}

export async function diagGet(url: URL, env: Env): Promise<Response> {
  if (!env.DIAG_KEY || url.searchParams.get('key') !== env.DIAG_KEY) return json({ error: 'not_found' }, { status: 404 });
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await env.STATE.list({ prefix: 'diag:', ...(cursor ? { cursor } : {}) });
    names.push(...r.keys.map((k) => k.name));
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  const last = names.sort().slice(-400);
  const events = await Promise.all(last.map(async (k) => JSON.parse((await env.STATE.get(k)) ?? '{}')));
  return json({ count: names.length, events });
}
