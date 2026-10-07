// A short desktop recording (1440×900) of connect, the three tabs, review, progress and proof, against the mocks:
// nothing is signed for real. Run with RECORD_OUT=<dir>; the .webm lands there.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mock, status, TEST_UA } from './mock';

const OUT = process.env.RECORD_OUT;
test.skip(!OUT, 'set RECORD_OUT');
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one project is enough'));
test.use({ viewport: { width: 1440, height: 900 }, video: { mode: 'on', size: { width: 1440, height: 900 } } });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const theme of ['light', 'dark'] as const)
  test(`desktop recording ${theme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await mock(page, {
      trusted: false,
      signDelayMs: 2500,
      statuses: [status.pending(), status.processing(), status.processing(), status.processing(), status.success()],
    });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Bring your ZEC home.' })).toBeVisible();
    await pause(1800);
    await page.getByRole('button', { name: 'Connect wallet' }).first().click();
    await pause(1500);
    await page.getByRole('dialog').getByRole('button', { name: /Phantom/ }).click();
    await expect(page.getByRole('button', { name: 'Review move' })).toBeVisible();
    await pause(2500);
    // The three modes of the one card.
    await page.getByRole('link', { name: 'Buy', exact: true }).click();
    await expect(page.getByText(/^1 ZEC ≈/)).toBeVisible();
    await pause(2200);
    await page.getByRole('link', { name: 'Check a wallet' }).click();
    await page.getByLabel(/Solana address/).pressSequentially('3hz4td165byB8njyWaXmrxG2zZsX2pJrGWprEpdbzit5', { delay: 12 });
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByText('Ready to move')).toBeVisible();
    await pause(2500);
    await page.getByRole('link', { name: 'Move', exact: true }).click();
    await pause(1200);
    // Where it lands, then review, sign, progress and proof.
    await page.getByText('Change', { exact: true }).first().click();
    await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
    await page.getByLabel('Zcash address').pressSequentially(TEST_UA.slice(0, 24), { delay: 25 });
    await page.getByLabel('Zcash address').fill(TEST_UA);
    await pause(900);
    await page.getByRole('button', { name: 'Continue' }).click();
    await pause(1200);
    await page.getByRole('button', { name: 'Review move' }).click();
    await expect(page.getByText('Quote signed by NEAR Intents')).toBeVisible();
    await pause(3000);
    await page.getByRole('button', { name: 'Sign in Phantom' }).click();
    await expect(page.getByText(/^Moving /)).toBeVisible({ timeout: 20_000 });
    await pause(2500);
    await expect(page.getByText('Check it in your wallet')).toBeVisible({ timeout: 40_000 });
    await pause(3000);
    await page.close();
    const v = await page.video()!.path();
    fs.mkdirSync(OUT!, { recursive: true });
    fs.copyFileSync(v, path.join(OUT!, `desktop-${theme}.webm`));
    void info;
  });
