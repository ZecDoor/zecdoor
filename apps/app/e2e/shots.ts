// Scenarios for each app screen, shared by the screenshot suite and the landing demo capture.
import { expect, type Page } from '@playwright/test';
import { status, TEST_UA, type Scenario } from './mock';

export async function own(page: Page) {
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await expect(page.getByText('Shielded address · can receive in Ironwood')).toBeVisible();
}

export type Shot = { name: string; scenario?: Scenario; clock?: boolean; go: (page: Page) => Promise<void> };

export const shots: Shot[] = [
  { name: 'connect', scenario: { trusted: false }, go: async (p) => void (await p.goto('./'), await expect(p.getByText('Connect Phantom')).toBeVisible()) },
  {
    name: 'picker',
    scenario: { trusted: false, otherWallets: ['Solflare', 'Backpack'] },
    go: async (p) => {
      await p.goto('./');
      await p.getByRole('button', { name: 'Connect wallet' }).first().click();
      await expect(p.getByRole('dialog', { name: 'Connect a wallet' })).toBeVisible();
    },
  },
  {
    name: 'wallet-menu',
    go: async (p) => {
      await p.goto('./');
      await p.getByRole('button', { name: /open wallet menu/ }).filter({ visible: true }).click();
      await expect(p.getByRole('menuitem', { name: 'Disconnect' }).filter({ visible: true })).toBeVisible();
    },
  },
  {
    name: 'signing',
    scenario: { hold: true },
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await expect(p.getByRole('button', { name: /Confirm in Phantom/ })).toBeVisible();
    },
  },
  { name: 'home', go: async (p) => void (await p.goto('./'), await expect(p.getByText('Move 0.0874 ZEC')).toBeVisible()) },
  { name: 'home-below-minimum', scenario: { zec: 37_814n }, go: async (p) => void (await p.goto('./'), await expect(p.getByText(/Below the bridge minimum/)).toBeVisible()) },
  { name: 'home-no-zec', scenario: { zec: 0n }, go: async (p) => void (await p.goto('./'), await expect(p.getByText('You have no ZEC on Solana.', { exact: false }).first()).toBeVisible()) },
  { name: 'home-paused', scenario: { health: { ok: false, paused: true, message: 'NEAR Intents reports an incident.' } }, go: async (p) => void (await p.goto('./'), await expect(p.getByText('The bridge is paused')).toBeVisible()) },
  { name: 'destination', go: own },
  {
    name: 'destination-error',
    go: async (p) => {
      await p.goto('./#/destination');
      await p.getByRole('button', { name: /Use my Zcash wallet/ }).click();
      await p.getByLabel('Zcash address').fill('t1J5WT7CwfJy7WJaMkYweYT2JUnSebbVRz4');
      await expect(p.getByText(/Transparent address/)).toBeVisible();
    },
  },
  {
    name: 'wallet-create',
    go: async (p) => {
      await p.goto('./');
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await expect(p.getByRole('button', { name: /Tap to show/ })).toBeVisible();
    },
  },
  {
    name: 'wallet-verify',
    go: async (p) => {
      await p.goto('./');
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: /Tap to show/ }).click();
      await p.getByRole('checkbox').check();
      await p.getByRole('button', { name: 'Check my backup' }).click();
      await expect(p.locator('fieldset')).toHaveCount(3);
    },
  },
  { name: 'topup', scenario: { zec: 37_814n }, go: async (p) => void (await p.goto('./#/topup'), await expect(p.getByText(/Arrives shielded/)).toBeVisible(), await expect(p.getByText('≥', { exact: false }).first()).toBeVisible()) },
  { name: 'buy', go: async (p) => void (await p.goto('./#/buy'), await expect(p.getByText(/^1 ZEC ≈/)).toBeVisible()) },
  {
    name: 'review',
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await expect(p.getByText(/Signed by NEAR Intents · checked|Quote signed by NEAR Intents/).filter({ visible: true }).first()).toBeVisible();
    },
  },
  {
    name: 'review-no-sol',
    scenario: { sol: 1_000_000n },
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await expect(p.getByText('Not enough SOL for fees')).toBeVisible();
    },
  },
  {
    name: 'progress',
    clock: true,
    scenario: { statuses: [status.processing()] },
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await expect(p.getByText('NEAR Intents saw your deposit')).toBeVisible();
      await p.clock.runFor(72_000); // a realistic elapsed time for the picture (1:12, as in the design)
    },
  },
  {
    name: 'progress-slow',
    clock: true,
    scenario: { statuses: [status.processing()] },
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await expect(p.getByText('NEAR Intents saw your deposit')).toBeVisible();
      await p.clock.fastForward('11:00');
      await expect(p.getByText('Taking longer than usual')).toBeVisible();
    },
  },
  {
    name: 'proof',
    clock: true,
    scenario: { statuses: [status.pending(), status.processing(), ...Array(40).fill(status.processing()), status.success()] },
    go: async (p) => {
      await p.goto('./');
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: /Tap to show/ }).click();
      const words = (await p.locator('ol.words li').allInnerTexts()).map((t) => t.replace(/^\d+\s*/, '').trim());
      await p.getByRole('checkbox').check();
      await p.getByRole('button', { name: 'Check my backup' }).click();
      await expect(p.locator('fieldset')).toHaveCount(3);
      for (const fs of await p.locator('fieldset').all()) {
        const n = Number((await fs.locator('legend').innerText()).replace(/\D/g, ''));
        await fs.getByRole('button', { name: words[n - 1]!, exact: true }).click();
      }
      await p.getByRole('button', { name: 'Continue to review' }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await expect(p.getByText(/^Moving /)).toBeVisible();
      // A realistic arrival time for the picture (3 min 40 s, as in the design), not the mock's instant one.
      const found = p.getByText('Note found by your browser');
      for (let i = 0; i < 90 && !(await found.isVisible()); i++) await p.clock.runFor(5_000);
      await expect(found).toBeVisible({ timeout: 25_000 });
    },
  },
  {
    name: 'refund',
    scenario: { statuses: [status.refunded()] },
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await expect(p.getByText('is back in your wallet on Solana')).toBeVisible({ timeout: 25_000 });
    },
  },
  {
    name: 'after',
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await p.getByRole('button', { name: 'What to do next' }).click({ timeout: 25_000 });
      await expect(p.getByText('2 · To keep it private', { exact: false })).toBeVisible();
    },
  },
  { name: 'counter', go: async (p) => void (await p.goto('./#/counter'), await expect(p.getByText('Fills in from launch day', { exact: false })).toBeVisible()) },
];

