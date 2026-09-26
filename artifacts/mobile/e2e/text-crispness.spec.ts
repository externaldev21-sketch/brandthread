import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * Text-crispness regression sweep.
 *
 * Genesis: the app owner measured `matrix(1,0,0,1,0,0)` — an identity
 * transform that still forces a compositing layer — on a 390/358px-wide
 * wrapper on /thread-checkout, and asked for a whole-app sweep so no text
 * (however small) ever renders blurry again. See lib/animationUtils.ts and
 * components/ui/AppText.tsx for the actual fixes this spec guards.
 *
 * Same manual-run model as e2e/brandthread-agent.spec.ts (its header comment
 * has the exact commands): this is a REAL, runnable spec, but it isn't
 * wired into CI here because that requires a live Postgres + api-server +
 * `expo start --web` dev server, none of which this sandbox has network/DB
 * access to stand up. Run it with:
 *
 *   1. api-server + Postgres, as e2e/brandthread-agent.spec.ts's header describes.
 *   2. From artifacts/mobile:
 *        EXPO_PUBLIC_API_BASE_URL=http://<host>:5000 \
 *        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<dummy-key> \
 *        pnpm exec expo start --web --port 8081
 *   3. From artifacts/mobile:
 *        PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers BASE_URL=http://127.0.0.1:8081 \
 *        pnpm exec playwright test -c e2e/playwright.config.ts e2e/text-crispness.spec.ts
 *
 * Every screen is visited via the `?bt_preview=buyer`/`?bt_preview=seller`
 * dev bypass (lib/devPreview.ts) with a fake-signed-in Clerk stub (reused
 * from e2e/brandthread-agent.spec.ts's own pattern), so it needs no real
 * account and exercises the app's own seeded preview data.
 */

// ─── Clerk stub (see e2e/brandthread-agent.spec.ts for the full explanation
// of why this is inlined rather than imported) ──────────────────────────────
function clerkStubScript(): string {
  const user = {
    id: 'user_preview_verify', firstName: 'Preview', lastName: 'Verify',
    username: 'previewverify', email: 'preview-verify@example.com', imageUrl: '',
  };
  return `(() => {
  const user = ${JSON.stringify(user)};
  const now = new Date();
  const email = { id: 'idn_demo', emailAddress: user.email, verification: { status: 'verified' } };
  const clerkUser = {
    ...user, fullName: user.firstName + ' ' + user.lastName, username: user.username, imageUrl: user.imageUrl,
    hasImage: false, primaryEmailAddress: email, primaryEmailAddressId: email.id, emailAddresses: [email],
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

async function hideDevErrorOverlay(page: Page) {
  await page.addStyleTag({
    content: '#error-overlay, #error-toast { display: none !important; }',
  }).catch(() => undefined);
}

/** Waits for CSS transitions/animations on the page to finish so assertions run at rest, not mid-motion. */
async function waitForAnimationsToSettle(page: Page) {
  await page.waitForTimeout(400); // let entrance springs/timings start
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 3000)), // don't hang on a looping/infinite animation
      ]),
    )
    .catch(() => undefined);
  await page.waitForTimeout(150);
}

// Pre-installed Chromium (see e2e/brandthread-agent.spec.ts) — no `playwright install` needed or should be run.
test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  },
});

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots', 'text-crispness');

/**
 * Screens named in the sweep. Each is visited at `/<path>?bt_preview=<role>`.
 * Routes that don't resolve to something (e.g. a detail screen with no seed
 * data wired up in this environment) still get checked — a broken/empty
 * state has its own text (error copy, empty-state copy) that must not be
 * blurry either.
 */
const SCREENS: Array<{ name: string; path: string; role: 'buyer' | 'seller' }> = [
  { name: 'feed', path: '/(tabs)/feed', role: 'buyer' },
  { name: 'thread-checkout', path: '/thread-checkout', role: 'buyer' },
  { name: 'buyer-checkout', path: '/buyer-checkout', role: 'buyer' },
  { name: 'buyer-product-detail', path: '/buyer-product-detail', role: 'buyer' },
  { name: 'inbox', path: '/(buyer)/inbox', role: 'buyer' },
  { name: 'buyer-conversation', path: '/buyer-conversation', role: 'buyer' },
  { name: 'buyer-profile', path: '/(buyer)/profile', role: 'buyer' },
  { name: 'edit-profile', path: '/edit-profile', role: 'buyer' },
  { name: 'activity-center', path: '/activity-center', role: 'buyer' },
  { name: 'seller-dashboard', path: '/(tabs)', role: 'seller' },
  { name: 'seller-products', path: '/(tabs)/products', role: 'seller' },
  { name: 'seller-orders', path: '/(tabs)/orders', role: 'seller' },
  { name: 'settings', path: '/settings', role: 'seller' },
];

/** Devices worth checking: 390x844 (the reported viewport) at 2x and 3x DPR. */
const DPRS = [2, 3];

for (const screen of SCREENS) {
  for (const dpr of DPRS) {
    test(`${screen.name} @ 390x844 x${dpr} — no blurry text at rest`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: dpr,
      });
      const page = await context.newPage();
      try {
        await page.addInitScript(clerkStubScript());
        await page.goto(`${screen.path}?bt_preview=${screen.role}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => undefined);
        await hideDevErrorOverlay(page);
        await waitForAnimationsToSettle(page);
        await hideDevErrorOverlay(page);

        // ── 1. No text node's nearest element ancestor has a non-identity
        //      transform, and none sits on a fractional device pixel. ──────
        const offenders = await page.evaluate((devicePixelRatio: number) => {
          const EPS = 0.06; // device-px tolerance for float rounding
          const bad: Array<{ text: string; reason: string }> = [];

          function nearestElement(node: Node): Element | null {
            return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
          }

          function hasLingeringTransform(value: string): boolean {
            if (!value || value === 'none') return false;
            // Any `transform` at all — including an identity
            // `matrix(1,0,0,1,0,0)` — fails here. A component genuinely at
            // rest should emit no `transform` (or `none`); an identity
            // matrix left in place still forces a compositing layer, which
            // is the exact bug reported at /thread-checkout.
            // See lib/animationUtils.ts.
            return true;
          }

          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              return (node.textContent ?? '').trim().length > 0
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            },
          });

          let node: Node | null;
          // eslint-disable-next-line no-cond-assign
          while ((node = walker.nextNode())) {
            const el = nearestElement(node);
            if (!el) continue;
            const text = (node.textContent ?? '').trim().slice(0, 60);
            const cs = getComputedStyle(el);

            if (hasLingeringTransform(cs.transform)) {
              bad.push({ text, reason: `non-identity/compositing transform: ${cs.transform}` });
              continue;
            }

            const rect = el.getBoundingClientRect();
            const devicePxX = rect.left * devicePixelRatio;
            const devicePxY = rect.top * devicePixelRatio;
            const fracX = Math.abs(devicePxX - Math.round(devicePxX));
            const fracY = Math.abs(devicePxY - Math.round(devicePxY));
            if (fracX > EPS || fracY > EPS) {
              bad.push({ text, reason: `fractional device-pixel offset: x=${devicePxX.toFixed(2)}, y=${devicePxY.toFixed(2)}` });
            }
          }
          return bad;
        }, dpr);

        // Report every offender at once instead of failing on the first.
        expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);

        // ── 2. No text color has alpha < 1 (a documented exemption list can
        //      go here if a real disabled-state case needs it — none does
        //      yet). ─────────────────────────────────────────────────────
        const translucentText = await page.evaluate(() => {
          function alphaOf(color: string): number {
            const m = color.match(/rgba?\(([^)]+)\)/);
            if (!m) return 1;
            const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
            return parts.length === 4 ? parts[3] : 1;
          }
          const bad: Array<{ text: string; color: string }> = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              return (node.textContent ?? '').trim().length > 0
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            },
          });
          let node: Node | null;
          // eslint-disable-next-line no-cond-assign
          while ((node = walker.nextNode())) {
            const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
            if (!el) continue;
            const cs = getComputedStyle(el);
            const color = (cs as any).webkitTextFillColor && (cs as any).webkitTextFillColor !== 'rgba(0, 0, 0, 0)'
              ? (cs as any).webkitTextFillColor
              : cs.color;
            const alpha = alphaOf(color);
            if (alpha < 1) {
              bad.push({ text: (node.textContent ?? '').trim().slice(0, 60), color });
            }
          }
          return bad;
        });
        // Known/accepted exemptions: none yet. Surface everything else.
        expect(translucentText, JSON.stringify(translucentText, null, 2)).toEqual([]);

        // ── 3. Screenshot crops for manual review (attached to the PR). ───
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${screen.name}-x${dpr}.png`),
          fullPage: false,
        }).catch(() => undefined);
      } finally {
        await context.close();
      }
    });
  }
}
