import { defineConfig, devices } from '@playwright/test'

const testPort = process.env.PLANTOPS_E2E_PORT ?? '5184'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:' + testPort,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Use preinstalled Chrome locally and on GitHub-hosted Ubuntu runners.
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port ' + testPort + ' --strictPort',
    url: 'http://127.0.0.1:' + testPort + '/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
