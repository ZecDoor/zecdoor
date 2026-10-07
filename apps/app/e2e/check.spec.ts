// The wallet check: no connection, the right verdict per balance, and the checked address never
// reaches our server or NEAR Intents (only the public Solana RPCs that read it).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mock, OWNER } from './mock';

test('checks an address without connecting, and keeps the address off our server and NEAR Intents', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/|1click\.chaindefuser\.com/.test(r.url())) seen.push(`${r.url()} ${r.postData() ?? ''}`);
  });
  await mock(page, { trusted: false });
  await page.goto('./#/check');
  await page.getByLabel('Solana address').fill('not-an-address');
  await expect(page.getByText('That is not a Solana address.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check' })).toBeDisabled();

  await page.getByLabel('Solana address').fill(OWNER);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page).toHaveURL(new RegExp(`#/check/${OWNER}$`));
  await expect(page.getByText('Ready to move')).toBeVisible();
  await expect(page.getByText('ZecDoor would move all 0.0874 ZEC', { exact: false })).toBeVisible();
  await expect(page.getByText('Arrives shielded, at least')).toBeVisible();
  // No wallet prompt was opened and nothing was signed.
  expect(await page.evaluate(() => (window as unknown as { __signed: unknown[] }).__signed.length)).toBe(0);

  expect(seen.length).toBeGreaterThan(0);
  for (const s of seen) expect(s).not.toContain(OWNER);

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

for (const [zec, verdict] of [
  [60_000n, 'Below the minimum, worth moving'],
  [20_000n, 'Not worth moving'],
  [0n, 'No ZEC on Solana here'],
] as const) {
  test(`verdict for ${zec} zat: ${verdict}`, async ({ page }) => {
    await mock(page, { trusted: false, zec });
    await page.goto(`./#/check/${OWNER}`);
    await expect(page.getByText(verdict, { exact: true })).toBeVisible();
    if (zec === 20_000n) await expect(page.getByText('would cost more than it is worth', { exact: false })).toBeVisible();
  });
}

test('a link that does not hold a Solana address says so', async ({ page }) => {
  await mock(page, { trusted: false });
  await page.goto('./#/check/0xabc');
  await expect(page.getByText('Not a Solana address', { exact: true })).toBeVisible();
});
