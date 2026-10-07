// The latest dated holder snapshot, taken at build time from the committed docs/stats-*.json files (made by
// scripts/stats/solana-zec-holders.mjs). Not live: the Stats page shows the date and the source file.

interface Tier {
  accounts: number;
  zec: number;
}
interface Snapshot {
  at: string;
  nonEmpty: number;
  zecTotal: number;
  worthMovingFromUsd: number;
  above: Tier;
  belowButWorthMoving: Tier;
  dust: Tier;
  shares: { above: string; belowButWorthMoving: string; dust: string };
}

const files = import.meta.glob<Snapshot>('../../../../docs/stats-*.json', { eager: true, import: 'default' });

/** The newest snapshot that has the three tiers, and its file name. */
export const HOLDERS = Object.entries(files)
  .filter(([, s]) => !!s.above)
  .map(([path, s]) => ({ file: path.split('/').pop()!, ...s }))
  .sort((a, b) => b.at.localeCompare(a.at))[0]!;
