#!/usr/bin/env node
/**
 * 393x852 screenshots + text-fit check for Settings → Notifications and
 * Email & in-app.   node scripts/notification-channels-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';
import { checkTextFit, zoomCards } from './store-screenshots/text-fit.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/notification-channels');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failures = 0;

async function audit(page, name) {
  const issues = await checkTextFit(page);
  console.log(`${name}: ${issues.length === 0 ? 'text-fit OK' : 'TEXT-FIT ISSUES'}`);
  for (const i of issues) console.log('   ', JSON.stringify(i));
  failures += issues.length;
}
const scrollAll = (page, to) => page.evaluate((top) => document.querySelectorAll('*').forEach((el) => {
  if (el.scrollHeight > el.clientHeight + 200) el.scrollTop = top ? el.scrollHeight : 0;
}), to);

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  rmSync(OUT, { recursive: true, force: true });
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
    const open = async (url, text) => {
      for (let i = 0; i < 5; i += 1) {
        await go(url);
        await page.waitForTimeout(2200);
        if (await page.getByText(text).first().isVisible().catch(() => false)) return;
      }
      throw new Error(`screen did not open: ${url}`);
    };

    await open('/notifications-settings?bt_preview=seller', 'Push notifications');
    await scrollAll(page, false);
    await page.screenshot({ path: path.join(OUT, '1-notifications-settings-top.png') });
    await audit(page, 'notifications-settings (top)');
    await zoomCards(page, OUT, '1-top');
    await scrollAll(page, true);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '2-notifications-settings-bottom.png') });
    await audit(page, 'notifications-settings (bottom)');
    await zoomCards(page, OUT, '2-bottom');

    await page.getByText('Email & in-app').first().click();
    await page.waitForTimeout(1500);
    await scrollAll(page, false);
    await page.screenshot({ path: path.join(OUT, '3-email-and-in-app-top.png') });
    await audit(page, 'email-and-in-app (top)');
    await zoomCards(page, OUT, '3-top');
    await scrollAll(page, true);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '4-email-and-in-app-bottom.png') });
    await audit(page, 'email-and-in-app (bottom)');
    await zoomCards(page, OUT, '4-bottom');

    await page.locator('[data-testid="quiet-hours-row"]').last().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, '5-quiet-hours-picker.png') });
    await audit(page, 'quiet-hours picker');
  } finally {
    await browser.close();
    close();
  }
  if (failures > 0) { console.log(`\n${failures} text-fit issue(s)`); process.exit(2); }
  console.log('\nall screens text-fit clean');
}
run().catch((e) => { console.error(e); process.exit(1); });
