// Every screen at common laptop and desktop sizes plus the phone, light and dark, as the user sees
// the first screen (viewport) and the whole page. Run with VIEWPORT_OUT=<dir>.
import { test } from '@playwright/test';
import path from 'node:path';
import { mock } from './mock';
import { shots } from './shots';

const OUT = process.env.VIEWPORT_OUT;
test.skip(!OUT, 'set VIEWPORT_OUT');
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one project is enough'));

const SIZES = [
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
  { w: 1280, h: 720 },
  { w: 390, h: 844 },
] as const;
const ONLY = process.env.VIEWPORT_ONLY?.split(',');

for (const s of shots.filter((x) => !ONLY || ONLY.includes(x.name)))
  for (const size of SIZES)
    for (const theme of ['light', 'dark'] as const)
      test(`${s.name} ${size.w}x${size.h} ${theme}`, async ({ page }) => {
        if (s.clock) await page.clock.install();
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await mock(page, s.scenario);
        await s.go(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT!, `${s.name}-${size.w}-${theme}.png`) });
      });
