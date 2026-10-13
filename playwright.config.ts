import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 20_000 }, reporter: 'list',
  use: { baseURL: process.env.BALLOT_URL ?? 'http://localhost:5173', channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
});
