#!/usr/bin/env node
/**
 * Regression check for the shared SwipeableActions change (PR for item 101a):
 * the Activity screen's swipe-to-reveal "..." / trash (#237) must behave
 * exactly as before. Runs at 390×844 against the real web build and checks,
 * with both real touch events and a mouse drag:
 *   - swiping a row left reveals "..." + trash (front translated -112px)
 *   - "..." opens the row menu; trash deletes the row
 *   - a plain tap on a row still fires the row's own onPress
 *   - a vertical drag does not open a row
 *
 *   node scripts/activity-swipe-regression-check.mjs [--skip-build] [--out=<dir>]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(MOBILE_ROOT, 'docs/pr-review/cart-swipe-remove-101a/activity-regression');
const VIEWPORT = { width: 390, height: 844 };
const ROW = '[aria-label*="started following you"], [aria-label*="liked"], [aria-label*="commented"], [aria-label*="mentioned"]';

async function rows(page) {
  return page.locator(ROW).count();
}

/** Front (translated) layer of the SwipeableActions around the nth row. */
async function frontOffset(page, index) {
  return page.locator(ROW).nth(index).evaluate((el) => {
    let node = el;
    while (node && !(node.style?.transform || '').includes('translateX')) node = node.parentElement;
    const match = /translateX\((-?[\d.]+)px\)/.exec(node?.style?.transform ?? '');
    return match ? Number(match[1]) : null;
  });
}

async function drag(page, index, dx, dy, mode) {
  const box = await page.locator(ROW).nth(index).boundingBox();
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height / 2;
  if (mode === 'touch') {
    const cdp = await page.context().newCDPSession(page);
    const pt = (px, py) => [{ x: px, y: py, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x + (dx * i) / 12, y + (dy * i) / 12) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const results = {};
  try {
    for (const mode of ['touch', 'mouse']) {
      const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined };
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
      for (let attempt = 0; ; attempt++) {
        await openScreen(page, activity, server.origin, 'buyer', '/activity-center');
        try { await page.locator(ROW).first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity);
      await waitForImages(page);
      const r = { rowsAtStart: await rows(page) };

      await drag(page, 0, -20, 70, mode);
      r.verticalDragOffset = await frontOffset(page, 0);

      await drag(page, 0, -170, 0, mode);
      r.swipeOffset = await frontOffset(page, 0);
      await page.screenshot({ path: path.join(OUT, `activity-swipe-revealed-${mode}.jpg`), type: 'jpeg', quality: 82 });

      await page.getByLabel('More options').first().click();
      await page.waitForTimeout(600);
      r.menuOpened = await page.getByText(/See less|Remove follower|Block/).first().isVisible().catch(() => false);
      await page.screenshot({ path: path.join(OUT, `activity-menu-from-swipe-${mode}.jpg`), type: 'jpeg', quality: 82 });
      await page.keyboard.press('Escape');
      await page.mouse.click(195, 60);
      await page.waitForTimeout(600);

      await drag(page, 1, -170, 0, mode);
      r.secondSwipeOffset = await frontOffset(page, 1);
      await page.getByLabel('Delete this notification').nth(1).click();
      await page.waitForTimeout(900);
      r.rowsAfterDelete = await rows(page);
      await page.screenshot({ path: path.join(OUT, `activity-after-trash-${mode}.jpg`), type: 'jpeg', quality: 82 });

      const urlBefore = page.url();
      await page.locator(ROW).last().click();
      await page.waitForTimeout(1200);
      r.tapNavigated = page.url() !== urlBefore;
      r.tapUrl = page.url().replace(server.origin, '');
      results[mode] = r;
      console.log(`  ${mode}:`, JSON.stringify(r));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
