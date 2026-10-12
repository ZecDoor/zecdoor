import { useEffect, useState } from 'react';

/**
 * Hash routes, so the app works as static files under /app/ and the back button works.
 *
 * In-app navigation never assigns location.hash: Phantom's in-app browser on iOS reloads the page on some fragment
 * navigations (seen on a device on 12 Oct 2026 for "#/"), which loses everything held in memory, such as a chosen
 * destination. history.pushState changes the address without a navigation; the router is told with a hashchange event.
 * Back and forward fire popstate (and hashchange), which the router also listens to.
 */
export function go(path: string, replace = false): void {
  const h = '#' + path;
  if (location.hash !== h || replace) {
    if (replace) history.replaceState(null, '', h);
    else history.pushState(null, '', h);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  window.scrollTo(0, 0);
}

/** In-app links (href="#/…") go through go(), not the browser's fragment navigation. Install once. */
export function routeLinks(): () => void {
  const on = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self')) return;
    e.preventDefault();
    go(a.getAttribute('href')!.slice(1));
  };
  document.addEventListener('click', on);
  return () => document.removeEventListener('click', on);
}

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [r, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return r;
}
