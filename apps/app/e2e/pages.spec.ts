// Activity and Stats (desktop pages). Stats never shows figures that are not real: with nothing counted it
// shows only the "Counting starts" state. Activity lists this browser's moves and says they stay here.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mock, status, TEST_UA } from './mock';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'desktop pages'));

test('stats before any move: only the counting-starts state, plus the dated holder tiers', async ({ page }) => {
  await mock(page);
  await page.goto('./#/stats');
  await expect(page.getByText('Counting starts with the first public move.')).toBeVisible();
  await expect(page.getByText('Moves completed')).toBeVisible();
  await expect(page.locator('.dbig')).toHaveCount(0);
  await expect(page.getByText(/^Source: docs\/stats-\d{4}-\d{2}-\d{2}\.json/)).toBeVisible();
  await expect(page.getByText('47,140')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('stats with a counter of zero moves still shows no figures', async ({ page }) => {
  await mock(page, { counter: { moves: 0, zecShieldedZat: '0', firstWallets: 0, smallBalances: 0, refunded: 0, medianSeconds: null, days: [], updatedAt: new Date().toISOString() } });
  await page.goto('./#/stats');
  await expect(page.getByText('Counting starts with the first public move.')).toBeVisible();
  await expect(page.locator('.dbig')).toHaveCount(0);
});

test('activity: empty state, then the move just made, kept in this browser', async ({ page }) => {
  await mock(page, { statuses: [status.processing(), status.success()] });
  await page.goto('./#/activity');
  await expect(page.getByText('kept in this browser only', { exact: false })).toBeVisible();
  await expect(page.getByText('No moves in this browser yet')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Review move' }).click();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Check it in your wallet')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByText('0.0874 ZEC → shielded')).toBeVisible();
  await expect(page.locator('.schip', { hasText: 'Arrived' })).toBeVisible();
  await page.getByRole('button', { name: /^Refunded/ }).click();
  await expect(page.getByText('No refunded moves.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
