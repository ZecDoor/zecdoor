// Screenshots of every app screen and key state at 1440 and 390, light and dark, for review
// before merge. Run with SCREENSHOTS=1; output goes to docs/screenshots/app/.

import { test } from '@playwright/test';
import path from 'node:path';
import { mock } from './mock';
import { shots } from './shots';

const OUT = path.join(import.meta.dirname, '../../../docs/screenshots/app');
const SIZES = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1');
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one project is enough'));

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
