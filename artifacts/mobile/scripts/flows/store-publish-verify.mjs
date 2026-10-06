#!/usr/bin/env node
/**
 * Seller Publish Store at 390×844 on the real web build (signed-in demo
 * seller, harness fake API). The server's storefront slug arrives as
 * "<slug>.brandthread.app" in settings.storeUrl; the screen used to append
 * ".brandthread.app" again. Asserts the address is shown exactly once, and
 * captures the screen.
 *
 *   node scripts/flows/store-publish-verify.mjs [--skip-build]
 * Output: docs/flows/screens/store-publish/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from '../store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/flows/screens/store-publish');
const device = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
mkdirSync(OUT, { recursive: true });
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
try {
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images });
  await openScreen(page, activity, server.origin, 'seller', '/store-publish');
  await page.waitForTimeout(1500);
  if (!page.url().includes('/store-publish')) await page.goto(`${server.origin}/store-publish?bt_preview=seller`);
  await page.getByText('Publish Store').first().waitFor({ timeout: 20_000 });
  await waitForQuietNetwork(activity);
  await page.waitForTimeout(1000);
  const text = await page.locator('body').innerText();
  const addresses = text.match(/https:\/\/[^\s]+/g) ?? [];
  check('the store address is shown', addresses.some((a) => a.endsWith('.brandthread.app')), JSON.stringify(addresses));
  check('the address never doubles ".brandthread.app"', !text.includes('.brandthread.app.brandthread.app'), JSON.stringify(addresses));
  await page.getByText(/^https:\/\/.*brandthread\.app/).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'store-publish.png') });
  await context.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
