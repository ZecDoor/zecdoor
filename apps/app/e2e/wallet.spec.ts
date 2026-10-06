import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Keypair } from '@solana/web3.js';
import { mock, TEST_UA, type Scenario } from './mock';

const toReview = async (page: Page) => {
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
};

test('signs through Wallet Standard when Phantom registers there', async ({ page }) => {
  await mock(page);
  await toReview(page);
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Check it in your wallet')).toBeVisible({ timeout: 25_000 });
  expect(await page.evaluate(() => (window as unknown as { __signedVia: string }).__signedVia)).toBe('standard');
});

test('falls back to Phantom’s own provider when it has not registered', async ({ page }) => {
  await mock(page, { standard: false });
  await toReview(page);
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Check it in your wallet')).toBeVisible({ timeout: 25_000 });
  expect(await page.evaluate(() => (window as unknown as { __signedVia: string }).__signedVia)).toBe('legacy');
});

test('the picker lists only Phantom as supported; other wallets are shown but cannot be picked', async ({ page }) => {
  await mock(page, { trusted: false, otherWallets: ['Solflare', 'Backpack'] });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect a wallet' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Phantom/ })).toBeVisible();
  await expect(dialog.getByText('Detected, not supported yet')).toBeVisible();
  for (const n of ['Solflare', 'Backpack']) {
    await expect(dialog.getByRole('listitem').filter({ hasText: n })).toContainText('Not tested end to end yet');
    await expect(dialog.getByRole('button', { name: new RegExp(n) })).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: /Phantom/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('0.0874 ZEC').first()).toBeVisible();
});

test('the wallet menu opens in the top layer, works from the keyboard and disconnects', async ({ page }) => {
  await mock(page);
  await page.goto('./');
  const btn = page.getByRole('button', { name: /open wallet menu/ }).filter({ visible: true });
  await btn.click();
  const menu = page.getByRole('menu', { name: 'Wallet' }).filter({ visible: true });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => el.matches(':popover-open'))).toBe(true);
  await expect(menu.getByRole('menuitem', { name: 'Copy address' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Change wallet' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(btn).toBeFocused();
  await btn.click();
  await menu.getByRole('menuitem', { name: 'Disconnect' }).click();
  await expect(page.getByRole('heading', { name: 'Bring your ZEC home.' })).toBeVisible();
});

test('an account switch during review stops it before signing and says so', async ({ page }) => {
  await mock(page);
  await toReview(page);
  const other = Keypair.generate().publicKey;
  await page.evaluate(([a, b]) => (window as unknown as { __switchAccount: (a: string, b: number[]) => void }).__switchAccount(a as string, b as number[]), [
    other.toBase58(),
    Array.from(other.toBytes()),
  ] as const);
  await expect(page.getByText('Your wallet switched accounts')).toBeVisible();
  await expect(page.getByText(/Nothing was sent/).first()).toBeVisible();
});

test.describe('accessibility, both themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [name, url, setup] of [
      ['connect', './', { trusted: false }],
      ['home', './', {}],
      ['review', null, {}],
      ['top-up', './#/topup', { zec: 50_000n }],
      ['buy', './#/buy', {}],
      ['counter', './#/counter', {}],
      ['picker', 'picker', { trusted: false, otherWallets: ['Solflare'] as string[] }],
    ] as const) {
      test(`no axe violations: ${name}, ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await mock(page, setup as Scenario);
        if (url === null) await toReview(page);
        else if (url === 'picker') {
          await page.goto('./');
          await page.getByRole('button', { name: 'Connect wallet' }).first().click();
        } else await page.goto(url);
        await page.waitForTimeout(900);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.failureSummary).join(' | ')}`)).toEqual([]);
      });
    }
  }
});

test.describe('balances worth less than a move costs', () => {
  test('dust gets a plain warning; the top-up is still there', async ({ page }) => {
    await mock(page, { zec: 20_000n });
    await page.goto('./');
    await expect(page.getByText('Worth less than moving it costs')).toBeVisible();
    await expect(page.getByRole('button', { name: /Top up and shield/ }).first()).toBeVisible();
  });
  test('a small balance above the line gets the normal top-up offer', async ({ page }) => {
    await mock(page, { zec: 60_000n });
    await page.goto('./');
    await expect(page.getByText(/Below the bridge minimum/)).toBeVisible();
    await expect(page.getByText('Worth less than moving it costs')).toHaveCount(0);
  });
});
