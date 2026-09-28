#!/usr/bin/env node
/**
 * Visual verification for the capsule compact<->regular transition fix:
 * (1) end-state screenshots (reduced motion, the harness every other
 * screenshot script uses) proving the two rest states are pixel-identical
 * to what shipped before this PR; (2) a handful of real-motion mid-transition
 * frames showing the capsule actually gliding rather than snapping.
 *
 *   node scripts/capsule-transition-screenshots.mjs
 *   node scripts/capsule-transition-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/capsule-transition/390x844/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { BUYER_USER, DEMO_TIME_ZONE, IMAGE_HOST, localStorageSeed, respond } from './store-screenshots/demo-data.mjs';
import { clerkStubScript } from './store-screenshots/clerk-stub.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'capsule-transition');
const VIEWPORT = { width: 390, height: 844 };
const DEMO_API = 'https://api.brandthread.test';

async function shot(page, dir, index, name, clip) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'allow', caret: 'hide', clip });
  console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

/** Real (non-reduced) motion context — see PR notes for why
 *  context.clock.install() is skipped and the intro-splash flag is
 *  pre-consumed (both needed to get past this sandbox's own startup
 *  animation, unrelated to the tab bar itself). */
async function openMotionContext(browser, origin) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'no-preference',
  });
  await context.addInitScript(clerkStubScript(BUYER_USER));
  await context.addInitScript((seed) => {
    if (sessionStorage.getItem('bt:screenshot-seeded')) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    localStorage.setItem('bt:intro-splash:launched:v1', 'true');
    sessionStorage.setItem('bt:screenshot-seeded', '1');
  }, localStorageSeed('buyer', {}));
  const activity = { lastApiAt: Date.now() };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === IMAGE_HOST) return route.fulfill({ status: 404, body: '' });
    if (url.origin === DEMO_API) {
      const cors = {
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      activity.lastApiAt = Date.now();
      const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
      if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.bringToFront();
  return { context, page, activity };
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  if (!skipBuild) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const outDir = path.join(OUTPUT_ROOT, '390x844');
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  let index = 0;
  // Bottom ~120px strip — the tab bar itself, cropped tight so the frame
  // sequence is easy to compare at a glance.
  const barClip = { x: 0, y: 844 - 130, width: 390, height: 130 };

  try {
    // ── End states, reduced motion (pixel-identical-endpoints check) ──
    const end = await openContext(browser, { device, role: 'buyer', origin, images });
    end.page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
    await openScreenReliably(end.page, end.activity, origin, 'buyer', '/discover');
    await end.page.waitForSelector('[data-testid="buyer-bottom-tab-bar"]', { timeout: 20_000 });
    await waitForImages(end.page);
    await shot(end.page, outDir, ++index, 'end-regular-discover', barClip);
    await end.page.getByTestId('buyer-tab-index').click();
    await end.page.waitForTimeout(150);
    await shot(end.page, outDir, ++index, 'end-compact-home', barClip);
    await end.page.getByTestId('buyer-tab-discover').click();
    await end.page.waitForTimeout(150);
    await shot(end.page, outDir, ++index, 'end-regular-discover-again', barClip);
    await end.context.close();

    // ── Real-motion mid-transition frames ──
    const motion = await openMotionContext(browser, origin);
    await openScreenReliably(motion.page, motion.activity, origin, 'buyer', '/discover');
    await motion.page.waitForSelector('[data-testid="buyer-bottom-tab-bar"]', { timeout: 20_000 });
    await motion.page.waitForTimeout(400);
    await waitForImages(motion.page);

    const el = motion.page.getByTestId('buyer-tab-index');
    const box = await el.boundingBox();
    await motion.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await motion.page.mouse.down();
    for (const t of [0, 60, 120, 180, 240]) {
      if (t > 0) await motion.page.waitForTimeout(60);
      await shot(motion.page, outDir, ++index, `mid-discover-to-home-t${String(t).padStart(3, '0')}ms`, barClip);
    }
    await motion.page.mouse.up();
    await motion.context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`\nDone. Screenshots in ${path.relative(MOBILE_ROOT, OUTPUT_ROOT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
