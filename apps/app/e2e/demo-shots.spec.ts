// Phone captures (390×844 at 2×, light and dark) for the landing page's self-playing demo.
// Run with DEMO_OUT=<dir>; the files go to the private landing repo's public/demo/.
import { test } from '@playwright/test';
import path from 'node:path';
import { mock } from './mock';
import { shots } from './shots';

const OUT = process.env.DEMO_OUT;
test.skip(!OUT, 'set DEMO_OUT');
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one project is enough'));

for (const name of ['connect', 'home', 'review', 'progress', 'proof'])
  for (const theme of ['light', 'dark'] as const)
    test(`demo ${name} ${theme}`, async ({ page }) => {
      const s = shots.find((x) => x.name === name)!;
      if (s.clock) await page.clock.install();
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mock(page, s.scenario);
      await s.go(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT!, `${name}-${theme}.png`) });
    });
