// Screenshots of every app screen and key state at 1440 and 390, light and dark, for review
// before merge. Run with SCREENSHOTS=1; output goes to docs/screenshots/app/.

import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { mock, status, TEST_UA, type Scenario } from './mock';

const OUT = path.join(import.meta.dirname, '../../../docs/screenshots/app');
const SIZES = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1');
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one project is enough'));

async function own(page: Page) {
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await expect(page.getByText('Shielded address · can receive in Ironwood')).toBeVisible();
}

type Shot = { name: string; scenario?: Scenario; clock?: boolean; go: (page: Page) => Promise<void> };

const shots: Shot[] = [
  { name: 'connect', scenario: { trusted: false }, go: async (p) => void (await p.goto('./'), await expect(p.getByText('Connect Phantom')).toBeVisible()) },
  { name: 'home', go: async (p) => void (await p.goto('./'), await expect(p.getByText('Move 0.0874 ZEC')).toBeVisible()) },
  { name: 'home-below-minimum', scenario: { zec: 37_814n }, go: async (p) => void (await p.goto('./'), await expect(p.getByText(/Below the bridge minimum/)).toBeVisible()) },
  { name: 'home-no-zec', scenario: { zec: 0n }, go: async (p) => void (await p.goto('./'), await expect(p.getByText('You have no ZEC on Solana.', { exact: false })).toBeVisible()) },
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
      await expect(p.getByText('Signed by NEAR Intents · checked')).toBeVisible();
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
    scenario: { statuses: [status.processing()] },
    go: async (p) => {
      await own(p);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('button', { name: /Move it to shielded/ }).click();
      await p.getByRole('button', { name: 'Sign in Phantom' }).click();
      await expect(p.getByText('NEAR Intents saw your deposit')).toBeVisible();
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
      await expect(p.getByText('Note found by your browser')).toBeVisible({ timeout: 25_000 });
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
      await expect(p.getByText('is back in your Phantom wallet on Solana')).toBeVisible({ timeout: 25_000 });
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

for (const s of shots)
  for (const size of SIZES)
    for (const theme of THEMES)
      test(`${s.name} ${size.w} ${theme}`, async ({ page }) => {
        if (s.clock) await page.clock.install();
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await mock(page, s.scenario);
        await s.go(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `${s.name}-${size.w}-${theme}.png`), fullPage: true });
      });
