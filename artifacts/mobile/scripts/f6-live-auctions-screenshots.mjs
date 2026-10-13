#!/usr/bin/env node
/**
 * 390x844 screenshots for F6 "Live 2/2" (auctions for 1-of-1s). Drives the
 * LIVE pager in the web preview with `&demo=1` (a local demo auction — see
 * lib/live/useLiveAuction.ts) and the `live_auctions` flag forced ON with a
 * page.route stub of /config/features (it is OFF by default).
 *
 *   node scripts/f6-live-auctions-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/live-auctions/ours/*.png (repo root)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/live-auctions/ours');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const API = 'https://api.brandthread.test';

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    await page.route(`${API}/api/v1/config/features**`, async (route) => {
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ flags: { live_auctions: true }, updatedAt: null }) });
    });
    await openScreen(page, activity, origin, 'buyer', '/live', { extraQuery: '&demo=1' });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 4 && !(await page.getByTestId('live-screen').first().isVisible().catch(() => false)); i++) {
      await page.evaluate(() => {
        history.pushState(history.state, '', '/live?bt_preview=buyer&demo=1');
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      });
      await page.waitForTimeout(2500);
    }
    await page.getByTestId('live-auction-card').first().waitFor({ timeout: 20_000 }).catch(async (e) => { await page.screenshot({ path: path.join(OUT, 'debug.png') }); throw e; });
    await page.waitForTimeout(3000);
    await shot(page, '01-auction-card-someone-winning');

    await page.getByTestId('live-auction-custom').first().click();
    await page.getByTestId('live-auction-bid-sheet').waitFor({ timeout: 8000 });
    await page.getByTestId('live-auction-bid-plus').click();
    await page.getByTestId('live-auction-bid-plus').click();
    await shot(page, '02-custom-bid-sheet');
    await page.getByTestId('live-auction-bid-submit').click();
    await page.waitForTimeout(1200);
    await shot(page, '03-you-are-winning-anti-snipe');

    // The demo auction ends after its (extended) timer: the winner gets "Pay".
    await page.getByTestId('live-auction-pay').first().waitFor({ timeout: 45_000 });
    await shot(page, '04-you-won-pay');
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
