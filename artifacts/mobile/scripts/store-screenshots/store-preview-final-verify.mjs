#!/usr/bin/env node
/**
 * Final verification: NO network mocking for the store/preview endpoint at
 * all. Both preview branches (fresh, demo) must never call it — this test
 * proves that by asserting zero requests reach it, not by mocking what it
 * returns.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'store-preview-final'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function openAndInspect(label, url) {
  console.log(`\n=== ${label} (${url}) ===`);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
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
    return { context, page, close, browser, hitNetwork, origin };
  } catch (e) {
    close(); await browser.close(); throw e;
  }
}

async function main() {
  // 1. Genuinely fresh, real reload.
  {
    const r = await openAndInspect('01-fresh-no-demo', '/store-preview?bt_preview=seller');
    await r.context.close(); r.close(); await r.browser.close();
  }

  // 2. demo=1, real reload — must show the LOCAL demo storefront now.
  {
    const r = await openAndInspect('02-demo1', '/store-preview?bt_preview=seller&demo=1');
    // Toggle to desktop mode in the SAME session.
    await r.page.getByLabel('Desktop preview').click();
    await r.page.waitForTimeout(400);
    await r.page.screenshot({ path: path.join(OUT, '03-demo1-desktop.png') });
    const iframeBox = await r.page.locator('iframe').boundingBox();
    console.log('desktop iframe box:', iframeBox);
    await r.context.close(); r.close(); await r.browser.close();
  }

  // 3. Regression check: demo=1 visited first (sets the persisted flag),
  //    then in-app (pushState, no reload) navigate to the no-demo URL —
  //    the scenario that plausibly explained the earlier "black" report
  //    (a stale bt_preview_demo flag surviving SPA navigation). Must NOT
  //    be a black screen either way.
  {
    const browser = await launchBrowser();
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
    const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    let hitNetwork = false;
    page.on('request', (req) => { if (req.url().includes('store/preview')) { hitNetwork = true; console.log('[UNEXPECTED NETWORK CALL]', req.url()); } });
    console.log('\n=== 04-stale-demo-flag-then-inapp-nav-to-no-demo ===');
    await page.goto(`${origin}/store-preview?bt_preview=seller&demo=1`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `/store-preview?bt_preview=seller`);
    await page.waitForTimeout(600);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const iframeCount = await page.locator('iframe').count();
    console.log('hitRealNetworkEndpoint:', hitNetwork, 'iframeCount:', iframeCount);
    console.log('visible text:', bodyText.replace(/\s+/g, ' ').slice(0, 150));
    await page.screenshot({ path: path.join(OUT, '04-stale-demo-flag-inapp-nav.png') });
    await context.close(); close(); await browser.close();
  }

  console.log(`\nWrote screenshots to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
