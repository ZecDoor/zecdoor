import { expect, test } from '@playwright/test';
import { mock } from './mock';

test('home shows the balance', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await mock(page);
  await page.goto('./');
  await expect(page.getByText('0.0874 ZEC').first()).toBeVisible();
  expect(errors).toEqual([]);
});
