// Display helpers. Amounts are bigint base units everywhere; formatting is the last step.

export const ZAT = 100_000_000n;

/** Base units → decimal string with trailing zeros removed (keeps at least `min` decimals). */
export function units(v: bigint, decimals: number, min = 0): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (frac.length < min) frac = frac.padEnd(min, '0');
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
}

export const zec = (zat: bigint, min = 2) => `${units(zat, 8, min)} ZEC`;
export const sol = (lamports: bigint) => `${units(lamports, 9, 2)} SOL`;
export const usdc = (v: bigint) => `${units(v, 6, 2)} USDC`;

/** Decimal string typed by the user → base units, or null when it is not a valid amount. */
export function parseUnits(s: string, decimals: number): bigint | null {
  const t = s.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [w = '0', f = ''] = t.split('.');
  if (f.length > decimals) return null;
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}

export const short = (s: string, head = 4, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

export const usd = (n: number) =>
  n >= 100 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

export const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const height = (h: number) => h.toLocaleString('en-US');
