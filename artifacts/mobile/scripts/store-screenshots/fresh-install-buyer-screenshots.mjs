/**
 * Fresh-install buyer walkthrough (?bt_preview=buyer, no demo=1): captures a
 * representative set of buyer screens with NO fake seeded API — every API
 * call genuinely fails, exactly like the real dev-web preview with no
 * backend reachable, so every screen renders through its actual empty-state
 * path instead of a stand-in demo server. Public content (Discover feed,
 * catalog/shop) still shows via the unconditional previewCatalog/
 * previewDiscover fallbacks; anything personal (Inbox, Following, Saved,
 * Orders, Activity, Thread Cash) must render its real first-run empty state.
 *
 * Usage: node scripts/store-screenshots/fresh-install-buyer-screenshots.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, serveBuild, waitForQuietNetwork } from './harness.mjs';

// No Clerk stub here, deliberately: ?bt_preview=buyer's whole point is to
// bypass Clerk/onboarding entirely (see app/_layout.tsx's PREVIEW_ROLE), and
// every screen's preview fallback is written against "no backend reachable,"
// not against a specific signed-in identity. A couple of screens
// (app/(buyer)/orders.tsx, activity-center.tsx, buyer-notifications.tsx) call
// Clerk's useAuth()/useUser() directly rather than checking isBuyerDevPreview()
// first, which is a separate, pre-existing gap noted in the PR rather than
// fixed here (out of scope for this data-layer audit).

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), '.fresh-install-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 393, height: 852 };

const SCREENS = [
  { name: '01-inbox', path: '/(buyer)/inbox' },
  { name: '02-following', path: '/(buyer)/friends' },
  { name: '03-discover', path: '/(buyer)/discover' },
  { name: '04-saved', path: '/buyer-saved' },
  { name: '05-orders', path: '/(buyer)/orders' },
  { name: '06-activity', path: '/activity-center' },
  { name: '07-thread-cash', path: '/thread-cash' },
  { name: '08-cart', path: '/(buyer)/cart' },
  { name: '09-profile', path: '/(buyer)/profile' },
  { name: '10-notifications', path: '/buyer-notifications' },
];

async function main() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const activity = { lastApiAt: 0 };
    // Every non-origin request (the real API host this build points at, and
    // any external asset host) fails outright — no fake seeded server at
    // all. This is exactly "no backend reachable," the real dev-web preview
    // condition every fallback in the app is written against.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === server.origin) return route.continue();
      activity.lastApiAt = Date.now();
      return route.abort();
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    // First load establishes the preview session (query param -> localStorage).
    await page.goto(`${server.origin}/?bt_preview=buyer`);
    await page.waitForTimeout(2000);

    for (const screen of SCREENS) {
      await page.evaluate((url) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `${screen.path}?bt_preview=buyer`);
      await waitForQuietNetwork(activity, 500, 4000).catch(() => {});
      await page.waitForTimeout(3000);
      // Give a lazily-loaded route chunk (non-tab screens) extra time, then
      // retry the screenshot once if we're still looking at the splash mark.
      const stillSplash = await page.evaluate(() => document.body.innerText.trim().length < 5).catch(() => false);
      if (stillSplash) await page.waitForTimeout(4000);
      const file = path.join(OUT_DIR, `${screen.name}.png`);
      await page.screenshot({ path: file });
      console.log('captured', screen.name, '->', file);
    }

    if (consoleErrors.length) {
      console.log('--- page errors seen during the walk ---');
      for (const e of consoleErrors) console.log(e);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
