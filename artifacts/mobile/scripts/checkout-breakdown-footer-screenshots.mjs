#!/usr/bin/env node
/**
 * Item 110: checkout's price breakdown folded into the sticky footer, live
 * at 390×844 on the store-screenshots harness (signed-in demo buyer, seeded
 * single-seller checkout with a promo code applied, fake API).
 *
 * Steps:
 *  - collapsed: "Total $X ⌃" above Place order;
 *  - tap the total: it expands, with a screenshot mid-animation and one
 *    settled. Checks that no payment request was made (the toggle and Place
 *    order are separate controls);
 *  - tap again: it collapses;
 *  - expand, then scroll the page: it collapses;
 *  - Reduce Motion: the height is final on the very next frame (no
 *    animation);
 *  - with Thread Cash applied (flag on, fake wallet): the expanded footer
 *    shows Order total → Thread Cash → Charged to card.
 *
 *   node scripts/checkout-breakdown-footer-screenshots.mjs <origin> [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/checkout-breakdown-footer-110'));
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;
const ROUTE = '/buyer-checkout?source=buynow&bt_preview=buyer';

function session({ threadCash = 0 } = {}) {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  group.availableMethods = [{ id: group.selectedMethodId, carrier: 'Seller shipping', service: 'Standard', priceCents: 1200, estimatedDays: 5, estimatedDelivery: 'Arrives in 4–6 business days', trackingIncluded: true, isRecommended: true }];
  const subtotalCents = group.items[0].priceCents;
  return {
    ...base,
    deliveryGroups: [group],
    isBuyNow: true,
    acknowledgments: [],
    shippingAddress: { ...base.shippingAddress, id: 'addr_home' },
    discounts: [{ code: 'TENOFF', type: 'fixed', value: 1000, description: '$10.00 off your order', isValid: true, appliedAmountCents: 1000 }],
    ...(threadCash ? { threadCashRedemption: { token: 'TCASH-JORDAN-1', discountCents: threadCash } } : {}),
    summary: {
      ...base.summary, subtotalCents, shippingTotalCents: 1200, discountTotalCents: threadCash,
      totalCents: subtotalCents + 1200 - threadCash,
    },
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function open(browser, images, { seed, reducedMotion = 'no-preference', threadCashFlag = false }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  await context.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('bt:110-seeded')) return;
    localStorage.setItem(key, value);
    sessionStorage.setItem('bt:110-seeded', '1');
  }, [CHECKOUT_KEY, JSON.stringify(seed)]);
  const payments = [];
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/config/features') {
      return json(route, { flags: { aiPhotoShoot: true, outfitSwap: true, boosts: true, manufacturerHub: true, threadCash: true, threadCashCheckoutDiscount: threadCashFlag }, updatedAt: null });
    }
    if (p === '/api/thread-cash') return json(route, { balanceCents: 0, openRedemptions: [], config: { maxRedemptionPerOrderCents: null }, streak: {} });
    if (p === '/api/buyer/addresses' && request.method() === 'GET') {
      return json(route, [{ id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true }]);
    }
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: [] });
    if (p === '/api/buyer/cart/validate' || p.startsWith('/api/buyer/checkout/session')) {
      payments.push(`${request.method()} ${p}`);
      return json(route, { error: 'not in this test' }, 500);
    }
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  await page.emulateMedia({ reducedMotion });
  await openScreen(page, activity, ORIGIN, 'buyer', '/buyer-checkout?source=buynow');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByTestId('checkout-total-toggle').waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, ROUTE);
    }
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(900);
  return { context, page, payments };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

const detailsHeight = (page) => page.getByTestId('checkout-breakdown-details').evaluate((el) => el.getBoundingClientRect().height);
const expandedState = (page) => page.getByTestId('checkout-total-toggle').evaluate((el) => {
  const holder = el.closest('[aria-expanded]') ?? el.querySelector('[aria-expanded]');
  return holder ? holder.getAttribute('aria-expanded') : `none (${el.tagName} ${[...el.attributes].map((a) => a.name).join(',')})`;
});

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = {};

  {
    const { context, page, payments } = await open(browser, images, { seed: session() });
    results.collapsed = { height: await detailsHeight(page), expanded: await expandedState(page), cta: (await page.getByTestId('checkout-place-order').innerText()).trim(), total: await page.getByTestId('checkout-total-toggle').innerText() };
    await shot(page, '01-collapsed-total-chevron');

    await page.getByTestId('checkout-total-toggle').click();
    // Catch a frame part-way open (the harness clock runs slow under load).
    await page.getByTestId('checkout-breakdown-details').evaluate((el) => new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const h = el.getBoundingClientRect().height;
        if ((h > 30 && h < 110) || performance.now() - start > 5000) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    }));
    results.midAnimationHeight = await detailsHeight(page);
    await shot(page, '02-expanding-mid-animation');
    // 220ms nominal; the harness's installed clock runs slow under load.
    await page.getByTestId('checkout-breakdown-details').evaluate((el) => new Promise((resolve) => {
      const start = performance.now();
      const tick = () => (el.getBoundingClientRect().height > 100 || performance.now() - start > 5000 ? resolve() : requestAnimationFrame(tick));
      tick();
    }));
    await page.waitForTimeout(600);
    results.expanded = { height: await detailsHeight(page), expanded: await expandedState(page), lines: (await page.getByTestId('checkout-breakdown-details').innerText()).replace(/\n+/g, ' | ') };
    await shot(page, '03-expanded-breakdown-above-place-order');
    results.paymentRequestsAfterToggle = [...payments];

    await page.getByTestId('checkout-total-toggle').click();
    await page.waitForTimeout(1500);
    results.collapsedAgain = { height: await detailsHeight(page), expanded: await expandedState(page) };
    await shot(page, '04-collapsed-again-second-tap');

    await page.getByTestId('checkout-total-toggle').click();
    await page.waitForTimeout(1500);
    results.beforeScroll = { height: await detailsHeight(page), expanded: await expandedState(page) };
    await page.getByTestId('checkout-scroll').evaluate((el) => {
      const scroller = el.scrollHeight > el.clientHeight ? el : el.querySelector('div');
      (scroller ?? el).scrollBy(0, 300);
    });
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1500);
    results.afterScroll = { height: await detailsHeight(page), expanded: await expandedState(page) };
    await shot(page, '05-scrolling-away-collapses');
    results.paymentRequests = payments;
    await context.close();
  }

  {
    const { context, page } = await open(browser, images, { seed: session(), reducedMotion: 'reduce' });
    await page.getByTestId('checkout-total-toggle').click();
    await page.waitForTimeout(40);
    results.reducedMotion = { heightAfter40ms: await detailsHeight(page) };
    await page.waitForTimeout(400);
    results.reducedMotion.heightSettled = await detailsHeight(page);
    await shot(page, '06-reduce-motion-instant');
    await context.close();
  }

  {
    const { context, page } = await open(browser, images, { seed: session({ threadCash: 4000 }), threadCashFlag: true });
    results.threadCashCollapsed = await page.getByTestId('checkout-total-toggle').innerText();
    await page.getByTestId('checkout-total-toggle').click();
    await page.waitForTimeout(1500);
    results.threadCashLines = (await page.getByTestId('checkout-breakdown-details').innerText()).replace(/\n+/g, ' | ');
    await shot(page, '07-expanded-with-thread-cash');
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
