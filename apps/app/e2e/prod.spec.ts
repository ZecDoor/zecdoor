// Against a production build served by the real Worker (PROD_URL=https://zecdoor.0xo.in/app/, or a local one).
// Real network; only Phantom is stubbed (read-only: connect, never sign). Checks the CSP
// allows everything the app needs and nothing breaks: balance via public RPC, live quote,
// WASM address check, sanctions list and health from our server.
import { expect, test } from '@playwright/test';

const URL = process.env.PROD_URL;
test.skip(!URL, 'set PROD_URL');

test('production build under its CSP, real network', async ({ page }) => {
  const violations: string[] = [];
  const errors: string[] = [];
  await page.exposeFunction('__csp', (v: string) => violations.push(v));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp(v: string): void }).__csp(`${e.violatedDirective} ${e.blockedURI}`));
    const owner = '3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5';
    const pk = { toString: () => owner };
    (window as unknown as Record<string, unknown>).phantom = {
      solana: {
        isPhantom: true,
        publicKey: pk,
        isConnected: true,
        connect: async () => ({ publicKey: pk }),
        disconnect: async () => {},
        signAndSendTransaction: async () => {
          throw new Error('read-only smoke test');
        },
        on() {},
        off() {},
      },
    };
  });
  await page.goto(URL!);
  await expect(page.getByText('ZEC on Solana')).toBeVisible();
  await expect(page.locator('.amount').first()).toHaveText(/\d.* ZEC/, { timeout: 20_000 }); // real balance via public RPC
  // Moves and buys stay closed in production until the mainnet runs pass (PROD_MOVES=open after that).
  if ((process.env.PROD_MOVES ?? 'closed') === 'closed') await expect(page.getByText('Opening soon').first()).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill('u1c5zssk2r6nasyar5amt5pw3szaes8h5wmer3qsaqkc2j6kjcae2lu95ycle3r8vvcdvpyfm7pdnx7624ckp7h5uwfa72l8y54cf4gu8m');
  await expect(page.getByText('Shielded address · can receive in Ironwood')).toBeVisible(); // WASM under CSP
  await page.goto(URL! + '#/buy');
  await expect(page.getByText(/^1 ZEC ≈/)).toBeVisible({ timeout: 20_000 }); // live signed dry quote, verified
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
