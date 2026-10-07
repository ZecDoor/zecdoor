// Scenarios for each app screen, shared by the screenshot suite and the landing demo capture.
import { expect, type Page } from '@playwright/test';
import { addressAt, loadZcashWasm, ufvkFromMnemonic } from '@zecdoor/zcash';
import fs from 'node:fs';
import path from 'node:path';
import { OWNER, status, TEST_UA, type Scenario } from './mock';

export async function own(page: Page) {
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await expect(page.getByText('Shielded address · can receive in Ironwood')).toBeVisible();
}

/** A move into a new wallet made here, to the after screen; returns the 24 words (test only). */
async function intoNewWallet(page: Page): Promise<string[]> {
  await page.goto('./');
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await expect(page.getByRole('heading', { name: 'Your new shielded wallet' })).toBeVisible();
  await page.getByRole('button', { name: /Tap to show/ }).click();
  const words = (await page.locator('ol.words li').allInnerTexts()).map((t) => t.replace(/^\d+\s*/, '').trim());
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Check my backup' }).click();
  await expect(page.locator('fieldset')).toHaveCount(3);
  for (const f of await page.locator('fieldset').all()) {
    const n = Number((await f.locator('legend').innerText()).replace(/\D/g, ''));
    await f.getByRole('button', { name: words[n - 1]!, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await page.getByRole('button', { name: 'What to do next' }).click({ timeout: 25_000 });
  return words;
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
  { name: 'home-below-minimum', scenario: { zec: 60_000n }, go: async (p) => void (await p.goto('./'), await expect(p.getByText(/Below the bridge minimum/)).toBeVisible()) },
  { name: 'home-dust', scenario: { zec: 20_000n }, go: async (p) => void (await p.goto('./'), await expect(p.getByText('Worth less than moving it costs')).toBeVisible()) },
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
      await expect(p.getByText('Taking longer than estimated')).toBeVisible();
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
  {
    name: 'after-restore-check',
    scenario: { statuses: [status.processing(), status.success()] },
    go: async (p) => {
      const words = await intoNewWallet(p);
      await loadZcashWasm(fs.readFileSync(path.join(import.meta.dirname, '../../../crates/zecdoor-wasm/pkg/zecdoor_wasm_bg.wasm')));
      await p.getByLabel('Address from your restored wallet').fill(addressAt(ufvkFromMnemonic(words.join(' '), 'main'), 'main', 0));
      await expect(p.getByText('Same wallet: this is its address number 0.', { exact: false })).toBeVisible();
      // Screenshots never show recovery words: the words were only on the earlier screen.
    },
  },
  { name: 'check', scenario: { trusted: false }, go: async (p) => void (await p.goto('./#/check'), await expect(p.getByRole('heading', { name: 'Check any Solana wallet' })).toBeVisible()) },
  { name: 'check-ready', scenario: { trusted: false }, go: async (p) => void (await p.goto(`./#/check/${OWNER}`), await expect(p.getByText('Arrives shielded, at least')).toBeVisible()) },
  { name: 'check-below', scenario: { trusted: false, zec: 60_000n }, go: async (p) => void (await p.goto(`./#/check/${OWNER}`), await expect(p.getByText('Below the minimum, worth moving')).toBeVisible()) },
  { name: 'check-dust', scenario: { trusted: false, zec: 20_000n }, go: async (p) => void (await p.goto(`./#/check/${OWNER}`), await expect(p.getByText('Not worth moving')).toBeVisible()) },
  { name: 'check-none', scenario: { trusted: false, zec: 0n }, go: async (p) => void (await p.goto(`./#/check/${OWNER}`), await expect(p.getByText('No ZEC on Solana here')).toBeVisible()) },
];

