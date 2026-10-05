// OFAC SDN digital-currency addresses for Solana, refreshed daily. The browser downloads the
// list and checks the wallet itself, so no wallet address is ever sent here.
// Source: github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (MIT), generated daily
// from OFAC's SDN list.

import { getJson, type Env } from './env';

export const SDN_SOL_URL =
  'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_SOL.txt';

export interface SanctionsList {
  updatedAt: string;
  source: string;
  solana: string[];
}

export async function refreshSanctions(env: Env, fetchImpl: typeof fetch, now = Date.now()): Promise<SanctionsList> {
  const r = await fetchImpl(SDN_SOL_URL);
  if (!r.ok) throw new Error(`SDN list HTTP ${r.status}`);
  const solana = (await r.text())
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s));
  const list = { updatedAt: new Date(now).toISOString(), source: SDN_SOL_URL, solana };
  await env.STATE.put('sanctions:sol', JSON.stringify(list));
  return list;
}

export async function sanctions(env: Env, fetchImpl: typeof fetch): Promise<SanctionsList> {
  return (await getJson<SanctionsList>(env.STATE, 'sanctions:sol')) ?? refreshSanctions(env, fetchImpl);
}
