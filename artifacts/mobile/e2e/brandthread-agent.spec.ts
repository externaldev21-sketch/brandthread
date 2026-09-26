import { test, expect } from '@playwright/test';
import path from 'node:path';
// Reimplements this repo's existing Clerk stub pattern (already used by the
// store screenshot / onboarding walkthrough scripts — see
// scripts/store-screenshots/clerk-stub.mjs's own header comment) to get a
// fake-but-signed-in `useAuth().userId` in the browser. Without it, screens
// that gate their data loading on Clerk's `userId` (inbox.tsx,
// buyer-conversation.tsx) never reach the ?bt_preview seeded-data fallback,
// since `?bt_preview` itself only skips the onboarding/splash gate, not each
// screen's own `if (!userId) return` guard. No real Clerk account, network
// call, or credential is involved — inlined here (rather than imported)
// because that file is an ESM module and this spec runs under Playwright's
// own transform.
function clerkStubScript(): string {
  const user = {
    id: 'user_preview_verify',
    firstName: 'Preview',
    lastName: 'Verify',
    username: 'previewverify',
    email: 'preview-verify@example.com',
    imageUrl: '',
  };
  return `(() => {
  const user = ${JSON.stringify(user)};
  const now = new Date();
  const email = { id: 'idn_demo', emailAddress: user.email, verification: { status: 'verified' } };
  const clerkUser = {
    ...user,
    fullName: user.firstName + ' ' + user.lastName,
    username: user.username,
    imageUrl: user.imageUrl,
    hasImage: false,
    primaryEmailAddress: email,
    primaryEmailAddressId: email.id,
    emailAddresses: [email],
    phoneNumbers: [], externalAccounts: [], passkeys: [], organizationMemberships: [],
    publicMetadata: {}, unsafeMetadata: {}, createdAt: now, updatedAt: now, twoFactorEnabled: false,
    reload: async () => clerkUser, update: async () => clerkUser, getSessions: async () => [],
  };
  const session = {
    id: 'sess_demo', status: 'active', user: clerkUser, actor: null, factorVerificationAge: [0, 0],
    lastActiveToken: { jwt: { claims: { sub: user.id, sid: 'sess_demo' } }, getRawString: () => 'demo-token' },
    getToken: async () => 'demo-token', touch: async () => session, end: async () => undefined, remove: async () => undefined,
  };
  const client = { id: 'client_demo', sessions: [session], activeSessions: [session], lastActiveSessionId: session.id, signIn: {}, signUp: {} };
  const listeners = new Set();
  const noop = () => undefined;
  const target = {
    loaded: false, version: '0.0.0-verify', sdkMetadata: { name: 'verify', version: '0.0.0' },
    instanceType: 'development', frontendApi: 'clerk.brandthread.test', publishableKey: '',
    isSatellite: false, isStandardBrowser: true, session, user: clerkUser, client, organization: null,
    __internal_lastEmittedResources: { client, session, user: clerkUser, organization: null },
    status: undefined, telemetry: { record: noop },
    async load() { this.loaded = true; },
    addListener(listener) { listeners.add(listener); listener({ client, session, user: clerkUser, organization: null }); return () => listeners.delete(listener); },
    on(event, handler) { if (event === 'status') handler('ready'); },
    off: noop, setActive: async () => undefined, signOut: async () => undefined,
    handleRedirectCallback: async () => undefined, navigate: async () => undefined, buildUrlWithAuth: (url) => url,
  };
  window.Clerk = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === 'then' || typeof prop !== 'string') return undefined;
      return noop;
    },
  });
  window.__internal_ClerkUICtor = function ClerkUIStub() {};
})();`;
}

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
