/**
 * Manufacturer Hub Phase 1 verification: fresh preview, &demo=1, and a
 * signed-in real-failure simulation (directory endpoint 500s), all at
 * 393x852, seller role.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), '.mfg-hub-screenshots');
mkdirSync(OUT_DIR, { recursive: true });
const VIEWPORT = { width: 393, height: 852 };

async function shootPreview(server, browser, images, demo) {
  const page = await (await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' })).newPage();
  const activity = { lastApiAt: 0 };
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === server.origin) return route.continue();
    activity.lastApiAt = Date.now();
    return route.abort();
  });
  const qs = demo ? '&demo=1' : '';
  await page.goto(`${server.origin}/manufacturer-hub?bt_preview=seller${qs}`);
  // Dev preview bypasses Clerk entirely (see app/_layout.tsx's devRole
  // branch) — there is no window.Clerk to wait on here.
  await page.waitForTimeout(2500);
  return page;
}

async function shootSignedInFailure(server, browser, images) {
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined },
    role: 'seller', origin: server.origin, images,
    onUnseeded: () => {},
  });
  // Simulate a real backend failure for a genuinely signed-in seller —
  // intercept just the directory search call and return a 500, ahead of
  // the harness's own fake-API route (Playwright runs the most-recently
  // added route handler first).
  await context.route('**/manufacturers/public*', (route) => {
    if (route.request().url().includes('/facets')) return route.continue();
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"boom"}}' });
  });
  // Real signed-in seller (openContext's Clerk stub), no bt_preview bypass —
  // exercises the actual production auth path, not the dev-preview one.
  await page.goto(`${server.origin}/manufacturer-hub`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
  await waitForQuietNetwork(activity, 800, 6000).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

async function main() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(process.cwd(), '.store-screenshots', 'demo-images'));

    const p1 = await shootPreview(server, browser, images, false);
    await p1.screenshot({ path: path.join(OUT_DIR, '01-fresh-preview.png') });
    console.log('captured fresh preview');
    await p1.context().close();

    const p2 = await shootPreview(server, browser, images, true);
    await p2.screenshot({ path: path.join(OUT_DIR, '02-demo-mode.png') });
    console.log('captured demo=1');
    await p2.context().close();

    const p3 = await shootSignedInFailure(server, browser, images);
    await p3.screenshot({ path: path.join(OUT_DIR, '03-signed-in-failure.png') });
    console.log('captured signed-in failure');
    await p3.context().close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
