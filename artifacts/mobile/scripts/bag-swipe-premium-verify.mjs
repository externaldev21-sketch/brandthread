#!/usr/bin/env node
/**
 * Bag swipe-to-remove polish — hands-on before/after check at 390×844 with
 * real CDP touch dispatch (touchStart / touchMove / touchEnd), motion on, on
 * the real web build (store-screenshots harness: demo buyer, fake API).
 *
 *   1. partial swipe (held mid-drag)  → reveal: Save + red Remove, symbol scale
 *   2. past the arm threshold (held)  → armed: full-row red, deepened, symbol pop
 *   3. release                        → per-frame samples of the exit: row x,
 *                                       row height / opacity (gap collapse),
 *                                       then the undo toast
 *   4. Undo                           → the line is back
 *   5. partial swipe + tap Remove     → same exit, line removed
 *
 *   node scripts/bag-swipe-premium-verify.mjs [--skip-build] --out=<dir>
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(MOBILE_ROOT, 'docs/pr-review/bag-swipe-premium/after');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const results = {};

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 85, caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

async function touch(page, x, y) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (px, py) => [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  let cx = x; let cy = y;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
  return {
    async move(tx, ty, steps = 10, stepMs = 16) {
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx + ((tx - cx) * i) / steps, cy + ((ty - cy) * i) / steps) });
        await page.waitForTimeout(stepMs);
      }
      cx = tx; cy = ty;
    },
    async end() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    },
  };
}

/** Row x, the remove panel's colours / symbol scale, row height + opacity. */
function installSampler(page, lineId) {
  return page.evaluate((id) => {
    const visible = (sel) => [...document.querySelectorAll(sel)].find((n) => n.offsetParent !== null);
    const row = visible(`[data-testid="cart-row-${id}"]`);
    const fg = row.parentElement;
    const clip = fg.parentElement;
    window.__s = [];
    const t0 = performance.now();
    const m = (el) => {
      const t = getComputedStyle(el).transform;
      const mm = /matrix\(([-\d.e]+), [-\d.e]+, [-\d.e]+, ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/.exec(t);
      return mm ? { s: +(+mm[1]).toFixed(3), x: +(+mm[3]).toFixed(1) } : { s: 1, x: 0 };
    };
    const tick = () => {
      const btn = visible(`[data-testid="bag-swipe-remove-${id}"]`);
      const sample = { t: Math.round(performance.now() - t0) };
      if (fg.isConnected) {
        sample.x = Math.round(fg.getBoundingClientRect().left - clip.getBoundingClientRect().left);
        // The slot the row occupies in the list (the collapsing wrapper).
        sample.h = Math.round(clip.parentElement.getBoundingClientRect().height);
        sample.o = +(+getComputedStyle(clip.parentElement).opacity).toFixed(2);
      } else sample.gone = true;
      if (btn) {
        sample.bg = getComputedStyle(btn).backgroundColor;
        const overlay = [...btn.children].find((c) => getComputedStyle(c).position === 'absolute');
        sample.deep = overlay ? +(+getComputedStyle(overlay).opacity).toFixed(2) : null;
        const inner = [...btn.children].find((c) => c.querySelector('svg, [data-testid], div') && getComputedStyle(c).position !== 'absolute') ?? btn.firstElementChild;
        sample.icon = m(inner).s;
      }
      window.__s.push(sample);
      if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, lineId);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const origin = server.origin;
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    // installClock off: the fake clock throttles requestAnimationFrame, which
    // would distort the per-frame timing being measured here.
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, installClock: false });
    await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, origin, 'buyer', '/');
      try { await page.getByTestId('feed-cart-button').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity);
    // The Bag is a preloaded hidden tab: open it from the feed's cart button.
    await page.getByTestId('feed-cart-button').first().click();
    const rowOf = (id) => page.locator(`[data-testid="cart-row-${id}"]:visible`).first();
    await rowOf('line_1').waitFor({ timeout: 12_000 });
    await waitForImages(page);
    await page.waitForTimeout(800);
    const lines = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="cart-row-"]')].filter((el) => el.offsetParent !== null).map((el) => el.getAttribute('data-testid').slice(9)));
    results.before = await lines();
    await shot(page, '01-bag-at-rest');

    // ── Full swipe, held at each stage, then released ───────────────────────
    const rb = await rowOf('line_1').boundingBox();
    const y = rb.y + 30;
    const x0 = rb.x + rb.width * 0.85;
    await installSampler(page, 'line_1');
    const t = await touch(page, x0, y);
    await t.move(x0 - 120, y, 10);
    await page.waitForTimeout(250);
    await shot(page, '02-reveal-mid-swipe');
    await t.move(x0 - rb.width * 0.62, y, 8);
    await page.waitForTimeout(250);
    await shot(page, '03-armed-past-threshold');
    // A quick final flick for momentum.
    await t.move(x0 - rb.width * 0.75, y, 3, 8);
    await t.end();
    for (const [i, ms] of [[1, 90], [2, 110], [3, 120]]) { await page.waitForTimeout(ms); await shot(page, `04-exit-frame-${i}`); }
    await page.waitForTimeout(900);
    await shot(page, '05-removed-undo-toast');
    results.fullSwipeSamples = await page.evaluate(() => window.__s);
    results.afterFullSwipe = await lines();
    results.toast = await page.getByTestId('bag-undo-toast').innerText().catch(() => null);

    // ── Undo ────────────────────────────────────────────────────────────────
    await page.getByText(/^Undo$/).first().click();
    await page.waitForTimeout(1000);
    await shot(page, '06-undo-restores');
    results.afterUndo = await lines();

    // ── Partial swipe, then tap Remove ──────────────────────────────────────
    const rb2 = await rowOf('line_1').boundingBox();
    const t2 = await touch(page, rb2.x + rb2.width * 0.7, rb2.y + 30);
    await t2.move(rb2.x + rb2.width * 0.7 - 160, rb2.y + 30, 10);
    await t2.end();
    await page.waitForTimeout(600);
    await shot(page, '07-open-tap-remove');
    await installSampler(page, 'line_1');
    await page.locator('[data-testid="bag-swipe-remove-line_1"]:visible').first().click();
    await page.waitForTimeout(1200);
    await shot(page, '08-tap-remove-removed');
    results.tapRemoveSamples = await page.evaluate(() => window.__s);
    results.afterTapRemove = await lines();

    console.log('  lines', JSON.stringify({ before: results.before, afterFullSwipe: results.afterFullSwipe, afterUndo: results.afterUndo, afterTapRemove: results.afterTapRemove, toast: results.toast }));
    await context.close();
  } finally {
    writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
