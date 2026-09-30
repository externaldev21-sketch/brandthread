#!/usr/bin/env node
/**
 * Verifies the PR #517 + gate-determinism fix directly against the
 * scenario it targets: a persisted 'buyer' role from earlier testing in
 * the same browser (the old isSellerDevPreview()-only check would read
 * this as NOT a seller dev preview and let the real network call fire).
 * Also re-verifies the two baseline scenarios still hold post-merge, all
 * with NO mocking of the store/preview endpoint at all.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'store-preview-root-cause'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function run(label, url, { seedBuyerRole = false } = {}) {
  console.log(`\n=== ${label} (${url}) seedBuyerRole=${seedBuyerRole} ===`);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    if (seedBuyerRole) {
      // Simulate a persisted 'buyer' role from earlier testing in this
      // same browser, BEFORE _layout.tsx's own module-load effect runs
      // (which would normally overwrite it correctly for THIS load, since
      // bt_preview=seller is in the URL) — this init script runs first,
      // exactly reproducing "an earlier session left this stale."
      await context.addInitScript(() => { try { localStorage.setItem('user_role', 'buyer'); } catch {} });
    }
    let hitNetwork = false;
    page.on('request', (req) => { if (req.url().includes('store/preview')) { hitNetwork = true; console.log('[UNEXPECTED NETWORK CALL]', req.url()); } });
    await page.goto(`${origin}${url}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(500);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const iframeCount = await page.locator('iframe').count();
    console.log('hitRealNetworkEndpoint:', hitNetwork, 'iframeCount:', iframeCount);
    console.log('visible text:', bodyText.replace(/\s+/g, ' ').slice(0, 150));
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    await context.close();
  } finally {
    close();
    await browser.close();
  }
}

async function main() {
  await run('01-fresh-no-demo', '/store-preview?bt_preview=seller');
  await run('02-demo1', '/store-preview?bt_preview=seller&demo=1');
  // The PR #517 scenario: bt_preview=seller in THIS load's URL, but
  // 'user_role' was left as 'buyer' by an init script running before
  // _layout.tsx's own module-load effect — proves the URL param itself
  // (not just the persisted fallback) is what isSellerDevPreview() reads
  // first, and that the OR-with-buyer fix covers the fallback path too.
  await run('03-stale-buyer-role-persisted', '/store-preview?bt_preview=seller', { seedBuyerRole: true });
  console.log(`\nWrote screenshots to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
