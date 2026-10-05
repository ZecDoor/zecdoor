/** The subset of Workers KV the server uses, so tests can pass an in-memory store. */
export interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

export interface Env {
  /** Aggregates, 24-hour duplicate checks, cached health, fee check and sanctions list. */
  STATE: Store;
  /** Secret mixed into the duplicate-check hash so it cannot be matched against public deposit addresses. */
  HASH_SALT: string;
  /** Our own Orchard-capable UA and Solana wallet, named only in the fee self-test's dry quotes. */
  FEE_TEST_RECIPIENT: string;
  FEE_TEST_REFUND: string;
  /** Static files (landing, app, docs) when deployed with Workers Static Assets. */
  ASSETS?: { fetch(r: Request): Promise<Response> };
}

export const json = (body: unknown, init: ResponseInit & { maxAge?: number } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': init.maxAge ? `public, max-age=${init.maxAge}` : 'no-store',
      ...(init.headers ?? {}),
    },
  });

export async function getJson<T>(s: Store, key: string): Promise<T | null> {
  const v = await s.get(key);
  return v ? (JSON.parse(v) as T) : null;
}
