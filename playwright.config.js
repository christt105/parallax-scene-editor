import { defineConfig, devices } from '@playwright/test';

// The site is static files, so the "build" is a static server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tools/serve.js 8123',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
