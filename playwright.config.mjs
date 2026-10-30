import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { trace: 'off', screenshot: 'only-on-failure' },
});
