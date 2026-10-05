/**
 * Deterministic JSON: object keys sorted, `undefined` members dropped, otherwise exactly
 * `JSON.stringify`. Matches `json-stable-stringify`, which 1Click uses to hash quotes.
 */
export function stableStringify(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return stableStringify((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v) ?? 'null').join(',') + ']';
  }
  const parts: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const s = stableStringify((value as Record<string, unknown>)[key]);
    if (s !== undefined) parts.push(JSON.stringify(key) + ':' + s);
  }
  return '{' + parts.join(',') + '}';
}
