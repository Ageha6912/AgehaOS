import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests (PRD §34.3) run against the production build served by
 * `vite preview`, so every run verifies the real artifact.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
