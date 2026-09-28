#!/usr/bin/env node
/**
 * Item 103 — live check of the add-to-cart "product image flies to the cart
 * icon" animation at 390×844, motion ON.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer
 * on the buyer Home feed, fake API) → SHOP pill → Shop sheet → size → Add to
 * cart, and samples on every animation frame:
 *   - the flying copy (testID cart-fly-item): its on-screen centre + size
 *   - the feed cart button's scale + badge
 * and reports where the flight starts (vs the product photo in the sheet),
 * where it lands (vs the cart icon centre), and that the badge bump starts
 * only once the image has arrived. A second run with Reduce Motion ON checks
 * there is no flight and the badge still updates. Frame strip saved too.
 *
 *   node scripts/cart-fly-screenshots.mjs [--skip-build] [--out=<dir>]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(MOBILE_ROOT, 'docs/pr-review/cart-fly-103');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BUTTON = '[data-testid="feed-cart-button"]';

async function open(browser, images, origin, { reducedMotion }) {
  for (let boot = 0; ; boot++) {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    // Mark the first-launch intro splash as seen so the run starts on Home.
    await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.addInitScript((selector) => {
      window.__samples = [];
      const read = () => {
        const fly = document.querySelector('[data-testid="cart-fly-item"]');
        // The feed's cart button: its testID once #287 lands, else the
        // animated wrapper around the "Open cart, N items" control.
        let btn = [...document.querySelectorAll(selector)].find((n) => n.offsetParent !== null);
        if (!btn) {
          const control = [...document.querySelectorAll('[aria-label^="Open cart"]')].find((n) => n.offsetParent !== null);
          btn = control?.parentElement ?? null;
        }
        const sample = { t: performance.now() };
        if (fly) {
          const r = fly.getBoundingClientRect();
          sample.fly = { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), o: Number(getComputedStyle(fly).opacity) };
        }
        if (btn) {
          const r = btn.getBoundingClientRect();
          const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(btn).transform);
          sample.btn = { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), s: m ? Math.round(Number(m[1]) * 1000) / 1000 : 1, badge: btn.innerText.trim() };
        }
        window.__samples.push(sample);
        requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    }, BUTTON);
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, origin, 'buyer', '/(buyer)');
      try { await page.getByText('Drop 04 is live').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    const guide = page.getByTestId('feed-gesture-guide');
    if (await guide.isVisible().catch(() => false)) {
      await guide.click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(600);
    // Home can intermittently hit the feed error boundary on dev before #283.
    if (await page.getByText('Something went wrong').count() && boot < 3) { await context.close(); continue; }
    return { context, page };
  }
}

async function openSheetAndPickSize(page) {
  // First tap expands the pill; the second opens the sheet.
  const pill = page.getByTestId('shop-tag-pill').filter({ visible: true }).first();
  await pill.click({ timeout: 8_000 });
  await page.waitForTimeout(700);
  await pill.click({ timeout: 8_000 });
  const sheet = page.getByTestId('shop-product-sheet');
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  const size = sheet.getByRole('radio');
  if (await size.count()) await size.first().click();
  await page.waitForTimeout(300);
  return sheet;
}

/** Home → Shop sheet with a size picked; retries a fresh load if the feed isn't interactive yet. */
async function openReadySheet(browser, images, origin, opts) {
  for (let attempt = 0; ; attempt++) {
    const { context, page } = await open(browser, images, origin, opts);
    try {
      const sheet = await openSheetAndPickSize(page);
      return { context, page, sheet };
    } catch (error) {
      await page.screenshot({ path: path.join(WORK_DIR, `cart-fly-debug-${attempt}.png`) }).catch(() => {});
      await context.close();
      if (attempt >= 3) throw error;
    }
  }
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    // Two starts: (1) the product photo is in view (sheet scrolled to top),
    // (2) the buyer scrolled down to the sizes, so the photo is out of view
    // and the flight lifts off the selected product's card thumbnail.
    for (const scenario of [{ id: 'photo', scrollTop: true }, { id: 'card', scrollTop: false }]) {
      const { context, page, sheet } = await openReadySheet(browser, images, server.origin, { reducedMotion: false });
      if (scenario.scrollTop) {
        await sheet.evaluate((el) => {
          for (const node of el.querySelectorAll('div')) {
            if (node.scrollHeight > node.clientHeight + 4 && getComputedStyle(node).overflowY !== 'visible') node.scrollTop = 0;
          }
        });
        await page.waitForTimeout(500);
      }
      // Candidate sources, as the buyer sees them: the photo's visible part
      // inside the sheet's scroll area, and the selected card's thumbnail.
      const sources = await sheet.evaluate((el) => {
        const round = (r) => r && { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
        const scroller = [...el.querySelectorAll('div')].filter((n) => n.scrollHeight > n.clientHeight + 4 && getComputedStyle(n).overflowY !== 'visible')
          .sort((a, b) => b.clientHeight - a.clientHeight)[0];
        const clip = scroller?.getBoundingClientRect();
        const imgs = [...(scroller ?? el).querySelectorAll('img')].map((img) => img.getBoundingClientRect()).sort((a, b) => b.width - a.width);
        const photo = imgs[0];
        const visiblePhoto = photo && clip ? { top: Math.max(photo.top, clip.top), bottom: Math.min(photo.bottom, clip.bottom) } : null;
        const card = el.querySelector('[aria-selected="true"] img')?.getBoundingClientRect();
        return {
          photoVisiblePx: visiblePhoto ? Math.max(0, Math.round(visiblePhoto.bottom - visiblePhoto.top)) : 0,
          photoVisibleCentre: visiblePhoto && visiblePhoto.bottom > visiblePhoto.top ? { cx: Math.round(photo.left + photo.width / 2), cy: Math.round((visiblePhoto.top + visiblePhoto.bottom) / 2) } : null,
          selectedCard: round(card),
        };
      });
      await page.screenshot({ path: path.join(OUT, `${scenario.id}-01-sheet-before-add.jpg`), type: 'jpeg', quality: 82 });
      const from = await page.evaluate(() => window.__samples.length);
      await sheet.getByLabel('Add to cart').click();
      for (let i = 0; i < 12; i++) await page.screenshot({ path: path.join(OUT, `${scenario.id}-frame-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 70 });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(OUT, `${scenario.id}-02-after-add.jpg`), type: 'jpeg', quality: 82 });
      const samples = (await page.evaluate(() => window.__samples)).slice(from);
      const flying = samples.filter((s) => s.fly);
      const t0 = flying[0]?.t ?? samples[0].t;
      const flightEnd = flying.at(-1)?.t;
      const bumpStart = samples.find((s) => s.btn && s.btn.s !== 1 && s.t >= t0)?.t;
      const cart = samples.find((s) => s.btn)?.btn;
      const trace = samples.filter((s) => s.t >= t0 - 20 && s.t <= t0 + 1700).map((s) => ({ ms: Math.round(s.t - t0), fly: s.fly ?? null, cartScale: s.btn?.s, badge: s.btn?.badge }));
      writeFileSync(path.join(OUT, `${scenario.id}-fly-trace.json`), JSON.stringify(trace, null, 1));
      console.log(`  motion on, ${scenario.id}:`, JSON.stringify({
        ...sources,
        flightStart: flying[0]?.fly,
        flightEnd: flying.at(-1)?.fly,
        cartIcon: cart && { cx: cart.cx, cy: cart.cy },
        flightMs: flightEnd != null ? Math.round(flightEnd - t0) : null,
        bumpStartsAfterArrivalMs: bumpStart != null && flightEnd != null ? Math.round(bumpStart - flightEnd) : null,
        badgeAfter: samples.at(-1)?.btn?.badge,
      }));
      await context.close();
    }
    {
      const { context, page, sheet } = await openReadySheet(browser, images, server.origin, { reducedMotion: true });
      const from = await page.evaluate(() => window.__samples.length);
      await sheet.getByLabel('Add to cart').click();
      await page.waitForTimeout(1600);
      const samples = (await page.evaluate(() => window.__samples)).slice(from);
      console.log('  reduce motion:', JSON.stringify({
        flewFrames: samples.filter((s) => s.fly).length,
        bumped: samples.some((s) => s.btn && s.btn.s !== 1),
        badge: `${samples.find((s) => s.btn)?.btn.badge} → ${samples.at(-1)?.btn?.badge}`,
      }));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
