import { defineConfig } from '@playwright/test';

// Runs e2e/prod.spec.ts against an already-running production build (no dev server).
export default defineConfig({
  testDir: './e2e',
  testMatch: 'prod.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 900 }, browserName: 'chromium' } }],
});
