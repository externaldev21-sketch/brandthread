#!/usr/bin/env node
/**
 * Before/after captures for the profile polish pass (390x844, dark, demo
 * harness: seeded storage + fake API, see scripts/store-screenshots/harness.mjs).
 *
 *   node scripts/polish-profiles-capture.mjs --label before|after [--build-dir <dir>] [--only <name>]
 *
 * Output: docs/screenshots/polish-profiles/<label>/ (repo root).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const LABEL = arg('label', 'after');
const OUT = path.resolve(arg('out', path.join(MOBILE_ROOT, '../../docs/screenshots/polish-profiles', LABEL)));
const BUILD_DIR = path.resolve(arg('build-dir', DEFAULT_BUILD_DIR));
const ONLY = arg('only', '');
mkdirSync(OUT, { recursive: true });

const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };

async function open(browser, images, origin, role, target) {
  const ctx = await openContext(browser, { device, role, origin, images });
  await ctx.page.goto(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
  await ctx.page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(ctx.activity, 500, 8_000);
  await ctx.page.waitForTimeout(1500);
  await waitForImages(ctx.page, 6_000);
  return ctx;
}

/** Scrolls the profile's list (the largest scrollable element) by `y`. */
async function scrollList(page, y) {
  await page.evaluate((dy) => {
    const els = [...document.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10;
    });
    els.sort((a, b) => b.clientHeight - a.clientHeight);
    els[0]?.scrollBy(0, dy);
  }, y);
  await page.waitForTimeout(700);
}

const SCENES = [
  // Buyer's own profile.
  { name: 'own-01-top', role: 'buyer', target: '/profile' },
  { name: 'own-02-scrolled', role: 'buyer', target: '/profile', run: (p) => scrollList(p, 420) },
  { name: 'own-03-bottom', role: 'buyer', target: '/profile', run: (p) => scrollList(p, 4000) },
  { name: 'own-04-more-menu', role: 'buyer', target: '/profile', run: async (p) => { await p.getByTestId('buyer-profile-more').click(); await p.waitForTimeout(700); } },
  // A brand's public profile, seen by a buyer.
  { name: 'brand-01-top', role: 'buyer', target: '/seller-profile?id=user_northline' },
  { name: 'brand-02-scrolled', role: 'buyer', target: '/seller-profile?id=user_northline', run: (p) => scrollList(p, 520) },
  { name: 'brand-03-more-menu', role: 'buyer', target: '/seller-profile?id=user_northline', run: async (p) => { await p.getByTestId('seller-profile-more').click(); await p.waitForTimeout(700); } },
  // Another buyer's profile, seen by a different account.
  { name: 'other-01-top', role: 'seller', target: '/buyer-other-profile?userId=user_jordan&name=Jordan%20Reyes&handle=%40jordanreyes' },
  { name: 'other-02-scrolled', role: 'seller', target: '/buyer-other-profile?userId=user_jordan&name=Jordan%20Reyes&handle=%40jordanreyes', run: (p) => scrollList(p, 420) },
];

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(BUILD_DIR);
  try {
    for (const scene of SCENES) {
      if (ONLY && !scene.name.includes(ONLY)) continue;
      const ctx = await open(browser, images, origin, scene.role, scene.target);
      try {
        await scene.run?.(ctx.page);
        await ctx.page.screenshot({ path: path.join(OUT, `${scene.name}.png`) });
        console.log(`saved ${scene.name}`);
      } catch (error) {
        console.log(`FAILED ${scene.name}: ${error.message}`);
      } finally {
        await ctx.context.close();
      }
    }
    console.log(`Saved to ${OUT}`);
  } finally {
    await browser.close();
    close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
