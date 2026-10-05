import { useEffect, useState } from 'react';

/** Hash routes, so the app works as static files under /app/ and the back button works. */
export function go(path: string, replace = false): void {
  const h = '#' + path;
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
  window.scrollTo(0, 0);
}

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [r, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
