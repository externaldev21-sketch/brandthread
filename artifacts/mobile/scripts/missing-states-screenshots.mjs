#!/usr/bin/env node
/**
 * Before/after screenshots for the "missing states" PR (393x852): for each
 * touched screen, the loaded state (must be identical before vs after), a
 * loading state (API delayed) and an error state (API aborted), plus the
 * offline banner (context offline, then back online).
 *
 *   node scripts/missing-states-screenshots.mjs after            # current tree
 *   node scripts/missing-states-screenshots.mjs before <baseRef> # screens reverted to baseRef
 *
 * Output: docs/pr-assets/missing-states/<screen>-<before|after>-<state>.png
 * Needs PLAYWRIGHT_BROWSERS_PATH pointing at an installed chromium.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const REPO_ROOT = path.resolve(MOBILE_ROOT, '..', '..');
const OUT = path.join(REPO_ROOT, 'docs', 'pr-assets', 'missing-states');
const DEMO_API = 'https://api.brandthread.test';

const SCREENS = [
  { name: 'buyer-notifications', role: 'buyer', target: '/buyer-notifications' },
  { name: 'buyer-friend-requests', role: 'buyer', target: '/buyer-friend-requests' },
  { name: 'connections', role: 'buyer', target: '/connections?type=followers' },
  { name: 'buyer-search-history', role: 'buyer', target: '/buyer-search-history' },
  { name: 'buyer-collection', role: 'buyer', target: '/buyer-collection?collectionId=col_demo' },
  { name: 'product-reviews', role: 'buyer', target: '/product-reviews?productId=prod_nl_hoodie_ember&productName=Heavyweight%20Hoodie' },
  { name: 'buyer-muted', role: 'buyer', target: '/buyer-muted' },
  { name: 'buyer-close-friends', role: 'buyer', target: '/buyer-close-friends' },
  { name: 'story-mentions', role: 'buyer', target: '/story-mentions' },
  { name: 'store-pages', role: 'seller', target: '/store-pages' },
  { name: 'store-collections', role: 'seller', target: '/store-collections' },
  { name: 'drafts', role: 'seller', target: '/drafts' },
];

const only = process.argv[4] ? process.argv[4].split(',') : null;
const [, , variant = 'after', baseRef] = process.argv;
const device = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

function git(args) { return execFileSync('git', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString(); }

async function shoot(browser, origin, images, screen, state) {
  const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
  const mode = { on: false };
  const want = screen.target.split('?')[0];
  await page.route(`${DEMO_API}/**`, async (route) => {
    if (!mode.on || route.request().method() === 'OPTIONS') return route.fallback();
    if (state === 'loading') { await new Promise((r) => setTimeout(r, 60_000)); return route.fallback(); }
    return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, body: '{"error":{"code":"INTERNAL","message":"boom"}}' });
  });
  try {
    let landed = false;
    for (let attempt = 0; attempt < 5 && !landed; attempt += 1) {
      mode.on = false;
      await openScreen(page, activity, origin, screen.role, screen.target, {
        beforeNavigate: async () => {
          if (state === 'loading') setTimeout(() => { mode.on = true; }, 30);
          else if (state === 'error') mode.on = true;
        },
      });
      await page.waitForTimeout(1200);
      landed = (await page.evaluate(() => window.location.pathname)).startsWith(want);
    }
    if (!landed) throw new Error('navigation never landed');
    if (state === 'loaded') { await waitForQuietNetwork(activity); await waitForImages(page); }
    await page.waitForTimeout(1500);
    if (state === 'loading') for (let i = 0; i < 12; i += 1) await page.clock.runFor(16).catch(() => {});
    await page.screenshot({ path: path.join(OUT, `${screen.name}-${variant}-${state}.png`) });
    console.log(`  ${screen.name} ${state}`);
  } catch (e) {
    console.warn(`  skipped ${screen.name} ${state}: ${String(e.message).split('\n')[0]}`);
  } finally { await context.close(); }
}

async function offlineShots(browser, origin, images) {
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  try {
    await openScreen(page, activity, origin, 'buyer', '/discover');
    await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(800);
    const banner = page.getByTestId('offline-banner');
    await page.screenshot({ path: path.join(OUT, 'offline-banner-online-hidden.png') });
    console.log('  banner visible while online:', await banner.isVisible().catch(() => false));
    const block = (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.abort('internetdisconnected');
    await page.route(`${DEMO_API}/**`, block);
    await context.setOffline(true);
    await banner.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'offline-banner-offline-shown.png') });
    await page.unroute(`${DEMO_API}/**`, block);
    await context.setOffline(false);
    await banner.waitFor({ state: 'hidden', timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'offline-banner-back-online-hidden.png') });
    console.log('  offline banner shown then hidden: ok');
  } catch (e) {
    console.warn(`  offline flow failed: ${String(e.message).split('\n')[0]}`);
    await page.screenshot({ path: path.join(OUT, 'offline-banner-FAILED.png') }).catch(() => {});
  } finally { await context.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let reverted = false;
  if (variant === 'before') {
    const files = git(['diff', '--name-only', baseRef, 'HEAD', '--', 'artifacts/mobile/app', 'artifacts/mobile/hooks', 'artifacts/mobile/components']).split('\n').filter(Boolean);
    const existing = files.filter((f) => { try { git(['cat-file', '-e', `${baseRef}:${f}`]); return true; } catch { return false; } });
    git(['checkout', baseRef, '--', ...existing]); reverted = existing;
  }
  try {
    buildPreviewWeb();
    const { origin, close } = await serveBuild(path.join(WORK_DIR, 'web-build'));
    const browser = await launchBrowser();
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
    try {
      for (const screen of SCREENS.filter((s) => !only || only.includes(s.name))) {
        for (const state of ['loaded', 'loading', 'error']) await shoot(browser, origin, images, screen, state);
      }
      if (variant === 'after') await offlineShots(browser, origin, images);
    } finally { await browser.close(); close(); }
  } finally {
    if (reverted) git(['checkout', 'HEAD', '--', ...reverted]);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
