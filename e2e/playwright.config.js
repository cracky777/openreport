const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const PORT = process.env.E2E_PORT || 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Three scenarios, three bugs that only exist in a running browser: a
// navigation that happened despite a refused save, a burst of requests fired by
// a mouse gesture, and two responses landing out of order. None of them is
// reachable from a unit test — which is the whole reason this harness exists.
module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests'),
  // One server, one database, seeded once: the specs must not interleave.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Anchored on this directory, not on the cwd the runner was invoked from —
  // otherwise the artefacts land at the repo root, outside .gitignore.
  outputDir: path.join(__dirname, 'test-results'),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }]]
    : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /seed\.setup\.js/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, '.tmp', 'auth.json'),
      },
    },
  ],
  webServer: {
    command: 'node e2e/start-server.js',
    cwd: path.join(__dirname, '..'),
    url: `${BASE_URL}/api/health`,
    // Never reuse: the suite's first act is to register the first account, which
    // only becomes admin on a virgin database.
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
