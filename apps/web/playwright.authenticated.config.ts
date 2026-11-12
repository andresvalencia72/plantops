import { defineConfig, devices } from '@playwright/test'

/** Production Vite build, but strictly loopback, with intercepted synthetic HTTP. */
export default defineConfig({
  testDir: './e2e-authenticated',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5186',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium',
    use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5186 --strictPort',
    url: 'http://127.0.0.1:5186/',
    // Deliberately do not reuse an unrelated process on this private port.
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
