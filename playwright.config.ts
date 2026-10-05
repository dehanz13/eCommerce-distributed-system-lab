import { defineConfig } from '@playwright/test';
import { cfg } from '@lab/runtime';
export default defineConfig({
  testDir: 'tests/browser',
  use: {
    baseURL: cfg.WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
  retries: 0,
  reporter: 'list',
  projects: [
    { name: 'shop', testIgnore: 'backend-console.spec.ts' },
    { name: 'operator', testMatch: 'backend-console.spec.ts', use: { baseURL: cfg.OPERATOR_URL } },
  ],
});
