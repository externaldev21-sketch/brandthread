#!/usr/bin/env node
/**
 * Cart (flat black, like checkout) and the order confirmation (one pinned
 * primary button), live at 390×844 on the store-screenshots harness:
 * signed-in demo buyer, seeded multi-seller cart, fake API.
 *
 *   node scripts/cart-confirmation-flat-screenshots.mjs <origin> <outDir> <before|after> [guest]
 *
 * Cart: the bag at rest, scrolled to the order summary, and the page
 * background / container fills measured (no grey boxes).
 * Confirmation: a seeded "confirmed" checkout (two orders), at rest and
 * scrolled to the bottom; measures how much of the screen the pinned
 * actions take.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, '../../docs/pr-review/checkout-followups'));
const MODE = process.argv[4] ?? 'after';
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const API = 'https://api.brandthread.test';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function open(browser, images, { seed } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  if (seed) {
    await context.addInitScript(([key, value]) => {
      if (sessionStorage.getItem('bt:ccf-seeded')) return;
      localStorage.setItem(key, value);
      sessionStorage.setItem('bt:ccf-seeded', '1');
    }, [CHECKOUT_KEY, JSON.stringify(seed)]);
  }
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/cart/validate') return json(route, { isValid: true, issues: [] });
    if (/payment-status/.test(p)) return json(route, { ready: true });
    // No quote in this run (the confirmation is seeded, nothing is priced).
    if (p.endsWith('/payment-intent/quote')) return json(route, { error: 'not in this run' }, 404);
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: [] });
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  return { context, page, activity };
}

const shot = async (page, name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${MODE}-${name}.png`), caret: 'hide' });
  console.log(`  ✓ ${MODE}-${name}`);
};

/** Background colors of every element that paints a non-black, non-transparent fill (the "grey boxes"). */
async function greyBoxes(page, rootSelector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const boxes = [];
    for (const el of root.querySelectorAll('div')) {
      const r = el.getBoundingClientRect();
      if (r.width < 300 || r.height < 60) continue; // containers only, not chips/thumbnails
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [rr, gg, bb, a = '1'] = m[1].split(',').map((v) => v.trim());
      if (Number(a) === 0) continue;
      if (+rr === 0 && +gg === 0 && +bb === 0) continue;
      boxes.push({ bg, w: Math.round(r.width), h: Math.round(r.height), testid: el.getAttribute('data-testid') });
    }
    return boxes;
  }, rootSelector);
}

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = {};

  // ── Cart ────────────────────────────────────────────────────────────────
  {
    const { context, page, activity } = await open(browser, images);
    await openScreen(page, activity, ORIGIN, 'buyer', '/(buyer)/cart');
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await page.getByText(/^Cart \(\d+\)$/).first().waitFor({ timeout: 12_000 });
        break;
      } catch (error) {
        if (attempt === 5) throw error;
        await page.evaluate(() => { history.pushState(history.state, '', '/cart?bt_preview=buyer'); dispatchEvent(new PopStateEvent('popstate')); });
      }
    }
    await waitForQuietNetwork(activity, 900, 20_000);
    await waitForImages(page);
    await page.waitForTimeout(1200);
    results.cartGreyBoxes = await greyBoxes(page, 'body');
    await shot(page, '01-cart-top');
    const scrollBy = (dy) => page.evaluate((delta) => {
      // The cart's ScrollView: the tallest scrollable element on the page.
      const scrollers = [...document.querySelectorAll('div')].filter((el) => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible');
      scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight);
      if (scrollers[0]) scrollers[0].scrollTop += delta;
    }, dy);
    await scrollBy(640);
    await page.waitForTimeout(700);
    await shot(page, '02-cart-second-seller');
    await scrollBy(560);
    await page.waitForTimeout(700);
    await shot(page, '03-cart-order-summary');
    await context.close();
  }

  // ── Order confirmation ─────────────────────────────────────────────────
  {
    const base = checkoutSession();
    const seed = {
      ...base,
      acknowledgments: [],
      step: 'confirmation',
      paidGroups: Object.fromEntries(base.deliveryGroups.map((group, i) => [group.sellerId, {
        stripeSessionId: `pi_demo:cs_${i}`, orderId: `order_demo_${i}`, orderNumber: `BT-1048${i + 2}`,
        amountTotalCents: group.items.reduce((s, it) => s + it.priceCents * it.quantity, 0) + 1200,
      }])),
    };
    const { context, page, activity } = await open(browser, images, { seed });
    await openScreen(page, activity, ORIGIN, 'buyer', '/buyer-checkout');
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await page.getByTestId('checkout-confirmation').waitFor({ timeout: 12_000 });
        break;
      } catch (error) {
        if (attempt === 5) throw error;
        await page.evaluate(() => { history.pushState(history.state, '', '/buyer-checkout?bt_preview=buyer'); dispatchEvent(new PopStateEvent('popstate')); });
      }
    }
    await waitForQuietNetwork(activity, 900, 20_000);
    await waitForImages(page);
    await page.waitForTimeout(2500);
    results.confirmation = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[role="button"]')]
        .map((el) => ({ label: (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' '), r: el.getBoundingClientRect() }))
        .filter((b) => b.r.height > 0);
      const full = buttons.filter((b) => b.r.width > 300 && b.r.height >= 44).map((b) => ({ label: b.label, top: Math.round(b.r.top), h: Math.round(b.r.height) }));
      const pinnedTop = Math.min(...full.filter((b) => b.top > 500).map((b) => b.top), 844);
      return { fullWidthButtons: full, pinnedAreaHeight: 844 - pinnedTop, labels: buttons.map((b) => b.label).filter(Boolean) };
    });
    await shot(page, '04-confirmation-top');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('div')) {
        if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight;
      }
    });
    await page.waitForTimeout(800);
    await shot(page, '05-confirmation-scrolled');
    await context.close();
  }

  writeFileSync(path.join(OUT, `${MODE}-results.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

run().catch((error) => { console.error(error); process.exit(1); });
