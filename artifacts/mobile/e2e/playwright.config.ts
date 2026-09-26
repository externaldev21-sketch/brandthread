import { defineConfig, devices } from '@playwright/test';

/**
 * Minimal Playwright setup scoped to manual verification of the Brandthread
 * Agent feature (see e2e/brandthread-agent.spec.ts).
 *
 * This does NOT start the Expo dev server or the api-server itself — both
 * must already be running (see the spec file's header comment for the exact
 * commands), matching how this was actually run for PR verification:
 *   - api-server on http://127.0.0.1:5000 (or another reachable host:port)
 *   - `pnpm exec expo start --web --port 8081` in artifacts/mobile
 *
 * BASE_URL can override the default http://127.0.0.1:8081.
 *
 * The pre-installed Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) is
 * used automatically; no `playwright install` is required or should be run.
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5000',
    viewport: { width: 390, height: 844 },
    screenshot: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
