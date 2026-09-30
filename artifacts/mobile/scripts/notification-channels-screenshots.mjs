#!/usr/bin/env node
/**
 * 393x852 screenshots for Settings → Notifications → Email & in-app.
 *   node scripts/notification-channels-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/notification-channels');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    await openScreen(page, activity, origin, 'seller', '/', {});
    await page.waitForTimeout(6000);
    const go = (target) => page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, target);
    for (let i = 0; i < 5; i += 1) {
      await go('/notifications-settings?bt_preview=seller');
      await page.waitForTimeout(2200);
      if (await page.getByText('Quiet hours').first().isVisible().catch(() => false)) break;
    }
    await page.getByText('Email & in-app').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '1-notifications-settings.png') });
    await page.getByText('Email & in-app').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, '2-email-and-in-app.png') });
    await page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 200) el.scrollTop = el.scrollHeight; }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '3-email-and-in-app-bottom.png') });
    console.log('done');
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
