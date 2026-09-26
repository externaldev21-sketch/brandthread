import { test, expect } from '@playwright/test';
import path from 'node:path';
import { clerkStubScript } from './clerkStub';

/**
 * Manual/local verification of the Brandthread Agent feature (PR #96) at
 * mobile viewport 390x844, via the ?bt_preview=buyer dev bypass
 * (app/_layout.tsx, lib/devPreview.ts) — no signed-in user required.
 *
 * How this was actually run (not run in CI):
 *   1. Local Postgres 16, `pnpm --filter @workspace/db run push && migrate`.
 *   2. api-server: `pnpm --filter @workspace/api-server run dev`
 *      (DATABASE_URL + a syntactically-valid dummy CLERK_PUBLISHABLE_KEY so
 *      the Clerk middleware itself doesn't 500 — see PR description).
 *   3. Mobile web, from artifacts/mobile:
 *      EXPO_PUBLIC_API_BASE_URL=http://<reachable-host>:5000 \
 *      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<same dummy key> \
 *      pnpm exec expo start --web --port 8081
 *   4. From artifacts/mobile:
 *      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *      pnpm exec playwright test -c e2e/playwright.config.ts
 *
 * Uses the pre-installed Chromium explicitly (no `playwright install`).
 */

const SCREENSHOT_DIR = path.join(__dirname, '__screenshots__');

test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  },
});

/**
 * The dev server's own React error overlay (LogBox) pops up for an
 * unrelated, expected-in-this-harness noise source: a background poll
 * (notifications/social) hitting the real local api-server with the fake
 * Clerk demo token from clerkStubScript(), which the real Clerk backend
 * correctly rejects with 401 — not a bug in the feature under test, and not
 * something that would happen for a genuinely signed-in user. The overlay
 * visually confirms this (an "API 401: Unauthorized" / "Failed to fetch"
 * message, not anything from brandthreadAgent.ts or buyer-conversation.tsx).
 * It only gets in the way of Playwright's actionability check (it sits over
 * the whole page), so it's hidden here rather than worked around with
 * `force: true`, which would also silently paper over a real problem.
 */
async function hideDevErrorOverlay(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '#error-overlay, #error-toast { display: none !important; }',
  }).catch(() => undefined);
}

test.describe('Brandthread Agent — mobile web preview (390x844)', () => {
  test('pinned inbox thread, welcome playback, quick reply, and freeform message', async ({ page }) => {
    await page.addInitScript(clerkStubScript());

    // ── 1. Inbox: pinned Brandthread Agent thread ──────────────────────────
    await page.goto('/(buyer)/inbox?bt_preview=buyer', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
    const agentRow = page.getByTestId('inbox-conversation-preview-conversation-brandthread');
    await expect(agentRow).toBeVisible({ timeout: 20_000 });
    // Dismiss the cookie consent banner once, up front — it's a fixed
    // bottom-anchored overlay that would otherwise sit on top of every
    // later screenshot and hide the chat content underneath it.
    const acceptCookies = page.getByRole('button', { name: 'Accept all' });
    if (await acceptCookies.isVisible().catch(() => false)) {
      await acceptCookies.click();
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-inbox-pinned-agent.png') });

    // ── 2. Open the thread; wait for the welcome typing animation to finish ─
    await hideDevErrorOverlay(page);
    await agentRow.click();
    await page.waitForURL(/buyer-conversation/, { timeout: 10_000 });
    await hideDevErrorOverlay(page);
    // Welcome messages type in one at a time; wait for the quick-reply chips
    // (sent as the final welcome message) to appear, which means playback
    // has completed.
    await expect(page.getByLabel('Show me Thread Cash')).toBeVisible({ timeout: 20_000 });
    await hideDevErrorOverlay(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-thread-welcome-complete.png') });

    // ── 3. Tap "Show me Thread Cash" quick reply ────────────────────────────
    await hideDevErrorOverlay(page);
    await page.getByLabel('Show me Thread Cash').click();
    await expect(page.getByText(/Thread Cash/i).last()).toBeVisible({ timeout: 15_000 });
    // Let the agent's reply bubble settle (canned reply is paced ~1-1.6s).
    await page.waitForTimeout(2_000);
    await hideDevErrorOverlay(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-thread-cash-reply.png') });

    // ── 4. Freeform message ─────────────────────────────────────────────────
    await hideDevErrorOverlay(page);
    const input = page.getByPlaceholder('Message…');
    await input.click();
    await input.fill("hey what's up");
    await page.getByTestId('conversation-send').click();
    await expect(page.getByText("hey what's up")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2_500);
    await hideDevErrorOverlay(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-freeform-reply.png') });
  });
});
