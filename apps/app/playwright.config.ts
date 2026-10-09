import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174/app/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, browserName: 'chromium' } },
    // Other engines, run on demand: BROWSERS=1 npx playwright test --project firefox --project webkit --project mobile-safari
    ...(process.env.BROWSERS
      ? [
          { name: 'firefox', use: { viewport: { width: 1440, height: 900 }, browserName: 'firefox' as const } },
          { name: 'webkit', use: { viewport: { width: 1440, height: 900 }, browserName: 'webkit' as const } },
          { name: 'mobile-safari', use: { ...devices['iPhone 14'], browserName: 'webkit' as const } },
        ]
      : []),
  ],
  webServer: {
    command: 'npx vite --mode e2e --port 5174 --strictPort',
    url: 'http://localhost:5174/app/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
