// Playwright configuration for the end-to-end smoke test (tests/e2e/smoke.spec.js). The app is
// built in development mode (pending content is practised, nothing is accepted yet) and served by
// tools/serve.js on port 4173; every test runs in a fresh Pixel 7 context. @playwright/test is
// pinned in package.json to the release whose Chromium is revision 1248 and installed for the run
// with `npm install --no-save` (Ruling 68); nothing of it is committed.
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: '../../test-results',
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tools/build-content.js --allow-pending && node tools/serve.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: ROOT,
  },
});
