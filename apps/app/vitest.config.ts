import { defineConfig } from 'vitest/config';

// Unit tests only; the browser flows are in e2e/ (Playwright).
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
