#!/usr/bin/env node
/**
 * Unlockable app icons on Settings > App icon (Appearance): before (dev) and
 * after with no level, Insider (Brushed silver unlocked) and Inner Circle
 * (both unlocked), at 393x852, via the store-screenshots harness with a fake
 * /api/brand-membership/mine.
 *
 *   node scripts/app-icons-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Output: docs/pr-assets/app-icons/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/app-icons');
const BASELINE_DIR = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: UA };
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});
const brand = (level) => ({ sellerId: 'user_northline', name: 'Northline Studio', handle: '', initials: 'NS', avatarUrl: null, level, spendCents: 1, next: null });

async function shoot(browser, images, origin, name, level) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  await context.route((url) => /\/api(\/v1)?\/brand-membership\/mine$/.test(url.pathname), (route) => (
    route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, { brands: level ? [brand(level)] : [] }))
  ));
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/appearance');
    await page.waitForTimeout(3000);
    if (!page.url().includes('appearance')) {
      await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, '/appearance?bt_preview=buyer');
    }
    try { await page.getByText('App icon').first().waitFor({ timeout: 30_000 }); break; } catch (e) {
      await page.screenshot({ path: path.join(WORK_DIR, 'app-icons-fail.png') });
      if (attempt >= 3) throw e;
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  // Scroll to the icon grid.
  await page.getByText('App icon').last().scrollIntoViewIfNeeded();
  await page.mouse.move(196, 500);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${name}-393x852.png`) });
  await context.close();
}

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    if (label === 'before') {
      await shoot(browser, images, server.origin, 'before-app-icon', null);
    } else {
      await shoot(browser, images, server.origin, 'after-locked', null);
      await shoot(browser, images, server.origin, 'after-insider', 'insider');
      await shoot(browser, images, server.origin, 'after-inner-circle', 'inner_circle');
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (only !== 'after') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`Baseline build missing at ${BASELINE_DIR}`);
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
