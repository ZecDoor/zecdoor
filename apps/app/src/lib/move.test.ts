import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MoveRequest } from './move';

// Unit builds, like production builds, do not set VITE_MOVES_OPEN: moves are closed.
// config.ts reads the page's location, so the modules are loaded after a stand-in is set.
let mod: { MOVES_OPEN: boolean; executeMove: (r: MoveRequest) => Promise<unknown> };
beforeAll(async () => {
  vi.stubGlobal('location', new URL('https://zecdoor.0xo.in/app/'));
  vi.stubGlobal('window', globalThis);
  const [config, move] = await Promise.all([import('../config'), import('./move')]);
  mod = { MOVES_OPEN: config.MOVES_OPEN, executeMove: move.executeMove };
});

describe('the moves switch', () => {
  it('is closed unless the build opens it', () => {
    expect(mod.MOVES_OPEN).toBe(false);
  });

  it('refuses before any network request or signature', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'));
    const sign = vi.fn();
    const req = { kind: 'exit', amount: 200_000n, provider: { signAndSendTransaction: sign } } as unknown as MoveRequest;
    await expect(mod.executeMove(req)).rejects.toMatchObject({ code: 'closed' });
    expect(sign).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
