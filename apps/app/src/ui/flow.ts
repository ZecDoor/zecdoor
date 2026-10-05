import { freshAddress } from '../lib/zcash';
import { getWallet, type BrowserWallet } from '../lib/store';
import { short } from '../lib/format';
import { go } from './router';
import type { Draft } from './state';

/**
 * After the user picks what to move, send them to the right next screen: straight to review
 * when the destination is known, or through wallet creation first. A wallet made here always
 * pays a fresh address (the next diversifier index).
 */
export async function continueWith(d: Draft, _cached: BrowserWallet | null, setDraft: (d: Draft) => void): Promise<void> {
  // Read the wallet from storage, not React state: the index must be the latest one saved.
  const wallet = (await getWallet()) ?? null;
  if (d.dest?.kind === 'own') {
    setDraft(d);
    go('/review');
    return;
  }
  if (wallet) {
    const address = await freshAddress(wallet.ufvk, wallet.nextIndex);
    setDraft({ ...d, dest: { kind: 'browser', address, index: wallet.nextIndex } });
    go('/review');
    return;
  }
  setDraft({ ...d, dest: undefined } as Draft);
  go('/wallet/new');
}

export function landsIn(d: Draft | null, wallet: BrowserWallet | null): string {
  if (d?.dest?.kind === 'own') return `My wallet · ${short(d.dest.address, 4, 4)}`;
  if (wallet) return 'My wallet in this browser · fresh address';
  return 'New shielded wallet in this browser';
}
