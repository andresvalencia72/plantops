import { defineConfig, devices } from '@playwright/test'

// Never reuse the owner's Vite/OIDC pilot; this suite requires a standalone
// Nest test server on port 3002 and a disposable localhost *_test database.
if (!process.env.PLANTOPS_ISOLATED_FIXTURE) {
  throw new Error('PLANTOPS_ISOLATED_FIXTURE required for isolated E2E');
}
export default defineConfig({
  testDir: './e2e-isolated',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5185',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], channel: 'chrome' },
  }],
  webServer: {
    command: 'VITE_PLANTOPS_ENABLE_REPORTS=isolated-test npm run dev -- --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
