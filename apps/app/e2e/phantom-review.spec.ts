// The 390 review: every app screen in a Phantom-sized viewport (390×664: iPhone width minus
// Phantom's own address bar and toolbar), first view and full page, light and dark.
// Run with REVIEW_OUT=<dir>.
import { test } from '@playwright/test';
import path from 'node:path';
import { mock } from './mock';
import { shots } from './shots';

const OUT = process.env.REVIEW_OUT;
test.skip(!OUT, 'set REVIEW_OUT');
test.use({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one project is enough'));

for (const s of shots)
  for (const theme of ['light', 'dark'] as const)
    test(`phantom ${s.name} ${theme}`, async ({ page }) => {
      if (s.clock) await page.clock.install();
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mock(page, s.scenario);
      await s.go(page);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      if (theme === 'light') {
        const audit = await page.evaluate(() => {
          const overflow = document.documentElement.scrollWidth - innerWidth;
          const small = [...document.querySelectorAll('a, button, input, [role="button"], label.check')]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && getComputedStyle(e).visibility !== 'hidden';
            })
            .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
          return { overflow, small };
        });
        console.log(`AUDIT ${s.name}: overflow ${audit.overflow}px; small targets: ${audit.small.join('; ') || 'none'}`);
      }
      await page.screenshot({ path: path.join(OUT!, `${s.name}-${theme}-full.png`), fullPage: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT!, `${s.name}-${theme}-view.png`) });
    });
