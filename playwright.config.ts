import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  // Steps wait on real git processes (a branch switch is ~20 of them incl. the refresh), whose latency
  // grows with parallel Electron instances; the 5 s/30 s defaults were hit under full-suite load.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' }
})
