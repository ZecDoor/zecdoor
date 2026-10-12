// TEMPORARY device diagnostics, preview builds only (build-site.sh sets VITE_DIAG=1 only with PREVIEW=1; deploy.sh
// refuses a production deploy of a build that has it). Sends short events to the preview Worker's /api/diag so a bug
// seen only inside Phantom's in-app browser can be traced. Never sends a full address, a key or a balance: addresses are
// cut to their first 6 characters here, before anything leaves the page. Remove this file and its calls after use.

export const DIAG = import.meta.env.VITE_DIAG === '1';
export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? 'dev';

const session = Math.random().toString(16).slice(2, 8);
let seq = 0;

/** First 6 characters of an address (or null), the only form an address may take in an event. */
export const a6 = (s: string | null | undefined): string | null => (s ? s.slice(0, 6) : null);

type Value = string | number | boolean | null | undefined;

export function diag(event: string, data: Record<string, Value> = {}): void {
  if (!DIAG) return;
  const body = JSON.stringify({ b: BUILD_ID, s: session, n: seq++, t: Date.now(), e: event, h: location.hash.slice(0, 40), ...data });
  try {
    void fetch('/api/diag', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch {
    /* diagnostics never break the app */
  }
}

/** Page-level events: load, route changes, visibility, focus, errors. */
export function startDiag(): void {
  if (!DIAG) return;
  diag('load', { ua: navigator.userAgent.slice(0, 120), phantom: !!(window as unknown as { phantom?: unknown }).phantom });
  addEventListener('hashchange', () => diag('route'));
  addEventListener('pageshow', (e) => diag('pageshow', { persisted: (e as PageTransitionEvent).persisted }));
  addEventListener('pagehide', () => diag('pagehide'));
  document.addEventListener('visibilitychange', () => diag('visibility', { state: document.visibilityState }));
  addEventListener('focus', () => diag('focus'));
  addEventListener('blur', () => diag('blur'));
  addEventListener('error', (e) => diag('error', { msg: String((e as ErrorEvent).message).slice(0, 120) }));
  addEventListener('unhandledrejection', (e) => diag('rejection', { msg: String((e as PromiseRejectionEvent).reason).slice(0, 120) }));
}
