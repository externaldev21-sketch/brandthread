#!/usr/bin/env node
/**
 * Buyer own-profile cleanup: no Edit / Share / add-friend row under the bio
 * (those live in the ••• sheet), no top-bar pencil, avatar on the left.
 * Shoots the buyer's own profile (390 + 375 wide, plus a long-name /
 * big-number layout stress test), the open ••• menu, and the seller's own +
 * a visited profile to show they're unchanged.
 *
 *   node scripts/buyer-profile-menu-screenshots.mjs --build-dir <dir> --out <dir>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const BUILD_DIR = arg('--build-dir') ?? DEFAULT_BUILD_DIR;
const OUT = path.resolve(arg('--out') ?? path.join(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'buyer-profile-menu', 'after'));
const ONLY = arg('--only');
const VIEWPORT = { width: 390, height: 844 };
const NARROW = { width: 375, height: 812 };

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85, animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function open(page, activity, origin, role, target, query) {
  await page.goto(`${origin}/?bt_preview=${role}${query}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(3000);
  await page.evaluate(() => { localStorage.removeItem('user_role'); });
  const url = `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}${query}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((next) => {
      history.pushState(history.state, '', next);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, url);
    await page.waitForTimeout(1200);
    const here = target.split('?')[0];
    if (await page.evaluate((h) => location.pathname === h && document.querySelectorAll('[data-testid]').length > 2, here)) return;
  }
}

/** Scrolls the screen's main scroll container by `dy` points. */
async function scrollBy(page, dy) {
  await page.mouse.move(195, 600);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(900);
}

const SCENES = [
  { name: '01-buyer-own-profile', role: 'buyer', target: '/profile', query: '&demo=1&banner=video', ready: 'buyer-profile' },
  { name: '02-buyer-own-profile-menu-open', role: 'buyer', target: '/profile', query: '&demo=1&banner=video', ready: 'buyer-profile', menu: true },
  { name: '03-buyer-own-profile-no-banner', role: 'buyer', target: '/profile', query: '&demo=1', ready: 'buyer-profile' },
  { name: '04-buyer-own-profile-long-name-big-numbers', role: 'buyer', target: '/profile', query: '&demo=1&banner=video', ready: 'buyer-profile', stress: true },
  { name: '05-buyer-own-profile-375-long-name-big-numbers', role: 'buyer', target: '/profile', query: '&demo=1&banner=video', ready: 'buyer-profile', stress: true, viewport: NARROW },
  { name: '06-seller-own-profile-unchanged', role: 'seller', target: '/profile', query: '&demo=1&banner=video', ready: 'profile-hero' },
  { name: '07-visited-seller-unchanged', role: 'buyer', target: '/seller-profile?id=user_northline', query: '&demo=1&banner=video', ready: 'seller-profile-hero' },
];

/** Layout stress test: swap the rendered name and stat numbers for a long name and big counts. */
async function stress(page) {
  await page.evaluate(() => {
    const header = document.querySelector('[data-testid="profile-banner-header"]');
    if (!header) return;
    const name = header.querySelector('[role="heading"]');
    if (name) name.firstChild.textContent = 'Alexandria Montgomery-Whitfield';
    const values = ['12.4K', '128.9K', '1.2M'];
    header.querySelectorAll('[data-testid^="profile-stat-"]').forEach((stat, index) => {
      const value = stat.querySelector('div[dir], div');
      const texts = [...stat.querySelectorAll('div')].filter((node) => node.children.length === 0);
      if (texts[0]) texts[0].textContent = values[index] ?? '9.9K';
      void value;
    });
  });
  await page.waitForTimeout(600);
}

async function run() {
  if (!arg('--build-dir')) buildPreviewWeb(BUILD_DIR);
  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const scene of SCENES) {
      if (ONLY && !scene.name.includes(ONLY)) continue;
      console.log(`\n== ${scene.name} ==`);
      const device = { viewport: scene.viewport ?? VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
      const { context, page, activity } = await openContext(browser, {
        device, role: scene.role, origin: server.origin, images,
        contextOptions: { reducedMotion: 'no-preference' },
      });
      page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
      try {
        await open(page, activity, server.origin, scene.role, scene.target, scene.query);
        if (scene.ready) await page.getByTestId(scene.ready).first().waitFor({ state: 'attached', timeout: 60_000 });
        await page.waitForTimeout(3000);
        await waitForImages(page).catch(() => {});
        if (scene.stress) await stress(page);
        if (scene.menu) {
          await page.getByTestId('buyer-profile-more').first().click();
          await page.waitForTimeout(1200);
        }
        await shot(page, scene.name);
      } catch (error) {
        console.log(`  FAILED: ${error.message.split('\n')[0]}`);
        await shot(page, `${scene.name}-error`).catch(() => {});
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
