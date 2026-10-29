#!/usr/bin/env node
/**
 * Micro-interactions pack 2 — hands-on check at 390×844 with real CDP touch
 * dispatch (touchStart / touchMove / touchEnd, the sequence a phone sends),
 * on the real web build (store-screenshots harness: demo accounts, fake API).
 *
 *   - Chart scrub (item 17): finger held on the analytics bar chart and the
 *     report line chart, frames mid-drag — lens follows the finger.
 *   - Swipe-to-delete (19): bag row dragged left — red Remove revealed; a
 *     full swipe removes the line.
 *   - Undo toast (20): slides up after the remove (its translateY sampled
 *     per frame), Undo restores the line.
 *   - Press scale (22): finger held on a dashboard stat tile — computed
 *     scale while pressed vs at rest.
 *   - Gliding pill thumb (18) and profile tab swipe (31) as extra frames.
 *
 *   node scripts/pack2-microinteractions-verify.mjs [--skip-build]
 * Output: docs/pr-review/pack2-microinteractions/ (+ results.json)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/pack2-microinteractions');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const results = {};

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

/** A held touch: returns move(x, y) / end() so frames can be taken mid-gesture. */
async function touch(page, x, y) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (px, py) => [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  let cx = x; let cy = y;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
  return {
    async move(tx, ty, steps = 10) {
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx + ((tx - cx) * i) / steps, cy + ((ty - cy) * i) / steps) });
        await page.waitForTimeout(16);
      }
      cx = tx; cy = ty;
    },
    async end() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    },
  };
}

async function open(browser, images, origin, role) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const ctx = await openContext(browser, { device, role, origin, images });
  await ctx.page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
  return ctx;
}

async function go(page, activity, origin, role, target, testId) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, role, target);
    try { await page.getByTestId(testId).first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(500);
}

async function lensState(page) {
  return page.evaluate(() => {
    const lens = [...document.querySelectorAll('[data-testid="chart-scrub-lens"]')].find((n) => n.offsetParent !== null);
    if (!lens) return null;
    const r = lens.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2), opacity: Number(getComputedStyle(lens).opacity), text: lens.innerText.replace(/\s+/g, ' ').trim() };
  });
}

async function scrubChart(page, testId, prefix) {
  const chart = page.getByTestId(testId).first();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await chart.boundingBox();
  const y = box.y + box.height * 0.5;
  const xs = [0.3, 0.55, 0.85].map((f) => box.x + box.width * f);
  const t = await touch(page, box.x + box.width * 0.2, y);
  const frames = [];
  for (const [i, x] of xs.entries()) {
    await t.move(x, y);
    await page.waitForTimeout(160);
    frames.push({ fingerX: Math.round(x), lens: await lensState(page) });
    await shot(page, `${prefix}-scrub-${i + 1}`);
  }
  await t.end();
  await page.waitForTimeout(400);
  frames.push({ released: true, lens: await lensState(page) });
  return frames;
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const origin = server.origin;
  try {
    // ── Seller: press scale, chart scrub, pill glide ─────────────────────────
    {
      const { context, page, activity } = await open(browser, images, origin, 'seller');
      await go(page, activity, origin, 'seller', '/(tabs)', 'seller-dashboard-stat-grid');
      await shot(page, '01-dashboard-at-rest');

      // Press scale on a stat tile: hold the finger down, read the scale.
      const tile = page.getByTestId('seller-dashboard-stat-tile-visitors').first();
      await tile.scrollIntoViewIfNeeded();
      const tb = await tile.boundingBox();
      const readScale = () => page.evaluate(() => {
        const el = document.querySelector('[data-testid="seller-dashboard-stat-tile-visitors"]');
        const inner = el?.firstElementChild ?? el;
        const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(inner).transform);
        return m ? Number(m[1]) : 1;
      });
      const rest = await readScale();
      const t = await touch(page, tb.x + tb.width / 2, tb.y + tb.height / 2);
      await page.waitForTimeout(220);
      const pressed = await readScale();
      await shot(page, '02-stat-tile-pressed');
      await t.end();
      await page.waitForTimeout(350);
      const released = await readScale();
      results.pressScale = { rest, pressed, released };
      console.log('  press scale', results.pressScale);

      // Analytics tab: bar-chart scrub.
      await go(page, activity, origin, 'seller', '/(tabs)/analytics', 'analytics-bar-chart');
      results.barScrub = await scrubChart(page, 'analytics-bar-chart', '03-bar');
      console.log('  bar scrub', JSON.stringify(results.barScrub));

      // A report's line chart.
      await go(page, activity, origin, 'seller', '/analytics-reports?report=advanced', 'insight-line-chart');
      results.lineScrub = await scrubChart(page, 'insight-line-chart', '04-line');
      console.log('  line scrub', JSON.stringify(results.lineScrub));

      // Gliding pill thumb (analytics-sales PillTabs): tap the second pill and
      // sample the thumb's x per frame.
      try {
        await go(page, activity, origin, 'seller', '/analytics-sales', 'pill-tabs-thumb');
        const thumbX = () => page.evaluate(() => {
          const n = [...document.querySelectorAll('[data-testid="pill-tabs-thumb"]')].find((e) => e.offsetParent !== null);
          return n ? Math.round(n.getBoundingClientRect().left) : null;
        });
        const before = await thumbX();
        const pills = page.locator('[data-testid="pill-tabs-thumb"]').first().locator('xpath=..').getByRole('button');
        await pills.nth(1).click();
        const samples = [];
        for (let i = 0; i < 12; i++) { samples.push(await thumbX()); await page.waitForTimeout(20); }
        await page.waitForTimeout(300);
        await shot(page, '05-pill-thumb-after-glide');
        results.pillGlide = { before, samples, after: await thumbX() };
        console.log('  pill glide', JSON.stringify(results.pillGlide));
      } catch (e) {
        results.pillGlide = { skipped: String(e.message ?? e).slice(0, 160) };
      }
      await context.close();
    }

    // ── Buyer: bag swipe-to-delete + undo toast; profile tab swipe ───────────
    {
      const { context, page, activity } = await open(browser, images, origin, 'buyer');
      await go(page, activity, origin, 'buyer', '/(buyer)/cart', 'cart-row-line_1');
      await shot(page, '06-bag-at-rest');
      const lines = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="cart-row-"]')].map((el) => el.getAttribute('data-testid').slice(9)));
      results.bagBefore = await lines();

      const row = page.getByTestId('cart-row-line_1');
      const rb = await row.boundingBox();
      const y = rb.y + 30;
      // Partial swipe: reveal Save + red Remove, frame held mid-gesture.
      let t = await touch(page, rb.x + rb.width * 0.7, y);
      await t.move(rb.x + rb.width * 0.7 - 160, y);
      await page.waitForTimeout(120);
      await t.end();
      await page.waitForTimeout(450);
      await shot(page, '07-bag-swipe-reveals-red-remove');
      results.removeButtonColor = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="bag-swipe-remove-line_1"]');
        return b ? getComputedStyle(b).backgroundColor : null;
      });

      // Tap the revealed Remove: the line leaves; sample the undo toast's slide-up.
      await page.evaluate(() => {
        window.__toast = [];
        const t0 = performance.now();
        const tick = () => {
          const el = document.querySelector('[data-testid="bag-undo-toast"]');
          if (el) {
            const m = /matrix\(([-\d.]+), [-\d.]+, [-\d.]+, [-\d.]+, [-\d.]+, ([-\d.]+)\)/.exec(getComputedStyle(el).transform);
            window.__toast.push({ t: Math.round(performance.now() - t0), ty: m ? Math.round(Number(m[2]) * 10) / 10 : 0, o: Number(getComputedStyle(el).opacity) });
          }
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.getByTestId('bag-swipe-remove-line_1').click();
      await page.waitForTimeout(60);
      await shot(page, '08-undo-toast-sliding-up');
      await page.waitForTimeout(700);
      await shot(page, '09-removed-undo-toast-settled');
      results.toastFrames = await page.evaluate(() => window.__toast);
      results.bagAfterRemove = await lines();
      results.toastText = await page.getByTestId('bag-undo-toast').innerText().catch(() => null);

      await page.getByText(/^Undo$/).first().click();
      await page.waitForTimeout(900);
      await shot(page, '10-undo-restores-line');
      results.bagAfterUndo = await lines();

      // Full swipe (past 55%) removes outright.
      const r2 = await page.getByTestId('cart-row-line_2').boundingBox();
      t = await touch(page, r2.x + r2.width * 0.85, r2.y + 30);
      await t.move(r2.x + r2.width * 0.85 - r2.width * 0.75, r2.y + 30, 14);
      await page.waitForTimeout(120);
      await shot(page, '11-full-swipe-armed');
      await t.end();
      await page.waitForTimeout(900);
      results.bagAfterFullSwipe = await lines();
      await shot(page, '12-full-swipe-removed');
      console.log('  bag', JSON.stringify({ before: results.bagBefore, afterRemove: results.bagAfterRemove, afterUndo: results.bagAfterUndo, afterFull: results.bagAfterFullSwipe, toast: results.toastText, red: results.removeButtonColor }));
      console.log('  toast frames', JSON.stringify(results.toastFrames.slice(0, 14)));

      // Profile: swipe the grid left — indicator mid-drag, then the next tab.
      try {
        await go(page, activity, origin, 'buyer', '/(buyer)/profile', 'profile-tab-swipe-area');
        const area = page.getByTestId('profile-tab-swipe-area').first();
        const ab = await area.boundingBox();
        const tabsSel = () => page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].filter((n) => n.offsetParent !== null).map((n) => `${n.getAttribute('aria-label')}:${n.getAttribute('aria-selected')}`));
        results.profileTabsBefore = await tabsSel();
        const sy = Math.min(ab.y + ab.height - 80, 700);
        t = await touch(page, ab.x + ab.width * 0.8, sy);
        await t.move(ab.x + ab.width * 0.8 - 120, sy);
        await page.waitForTimeout(100);
        await shot(page, '13-profile-swipe-mid-drag');
        await t.move(ab.x + ab.width * 0.8 - 200, sy, 4);
        await t.end();
        await page.waitForTimeout(600);
        await shot(page, '14-profile-swipe-next-tab');
        results.profileTabsAfter = await tabsSel();
        console.log('  profile tabs', JSON.stringify({ before: results.profileTabsBefore, after: results.profileTabsAfter }));
      } catch (e) {
        results.profileSwipe = { skipped: String(e.message ?? e).slice(0, 160) };
      }
      await context.close();
    }
  } finally {
    writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
