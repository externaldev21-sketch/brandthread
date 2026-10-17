#!/usr/bin/env node
/**
 * Bag + buyer My orders polish (audit items 75-84), at 390x844 on a local
 * replica of the Replit preview: the DEV bundle (`expo start --web`) at
 * ?bt_preview=buyer, signed out, with every non-public API call answered 401
 * the way the real API answers a no-account preview.
 *
 * Shots (prefix = before|after):
 *   bag-empty           #75 one word, #76 back control, #77 centered CTA
 *   orders-top          #79 order number, #80 photo, #81 tracker labels, #82 no button
 *   orders-photo-failed #80 photo that fails to load -> brand fallback
 *   orders-chips-end    #83 filter row scrolled to its end
 *   orders-returns      #83 Returns tab selected
 *   orders-bottom       #84 demo=1 list scrolled to the end, above the tab bar
 * Also prints the back control's tap area, the CTA's centre offset and the
 * last card's gap to the tab bar.
 *
 * Usage: start the dev server first, e.g.
 *   EXPO_PUBLIC_API_BASE_URL=https://api.brandthread.test \
 *   EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_<base64 of "clerk.brandthread.test$"> \
 *   npx expo start --web --port 8099
 * then: node scripts/store-screenshots/polish-bag-orders-verify.mjs [origin] [outDir] [prefix]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser } from './harness.mjs';
import { clerkStubScript } from './clerk-stub.mjs';
import { BUYER_USER } from './demo-data.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, '../../docs/screenshots/polish-bag-orders'));
const PREFIX = process.argv[4] ?? 'after';
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };

// The harness Clerk stub, turned signed out: the Replit preview is browsed
// with no account, which is what switches the buyer screens onto their
// preview fallbacks (and keeps the dev error overlay from covering the page).
const SIGNED_OUT_CLERK = clerkStubScript(BUYER_USER)
  .replace("const client = { id: 'client_demo', sessions: [session], activeSessions: [session], lastActiveSessionId: session.id,",
    "const client = { id: 'client_demo', sessions: [], activeSessions: [], lastActiveSessionId: null,")
  .replace(/session,\n    user: clerkUser,/, 'session: null,\n    user: null,')
  .replaceAll('{ client, session, user: clerkUser, organization: null }', '{ client, session: null, user: null, organization: null }');

const CORS = (req) => ({
  'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
});

/** photos: 'load' serves the preview's Unsplash photos from local demo art; 'fail' makes them 404. */
async function newPage(browser, images, { photos = 'load', signedIn = false, buyerOrders = null } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.addInitScript(signedIn ? clerkStubScript(BUYER_USER) : SIGNED_OUT_CLERK);
  // Pre-answer the cookie banner so it doesn't cover the screens.
  await context.addInitScript(() => {
    try { localStorage.setItem('bt:cookie-consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, decidedAt: Date.now() })); } catch {}
  });
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !/^\/api(\/v1)?\/public\//.test(url.pathname), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS(req) });
    const url = new URL(req.url());
    if (buyerOrders && /^\/api(\/v1)?\/buyer\/orders\/?$/.test(url.pathname)) {
      return route.fulfill({ status: 200, headers: CORS(req), contentType: 'application/json', body: JSON.stringify(buyerOrders) });
    }
    return route.fulfill({ status: 401, headers: CORS(req), contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  const art = [images['look-mono'], images['jacket-onyx']];
  let n = 0;
  await context.route((url) => url.hostname === 'cdn.brandthread.test', (route) => (
    route.fulfill({ path: images[new URL(route.request().url()).pathname.slice(1)], contentType: 'image/jpeg' })
  ));
  await context.route((url) => url.hostname === 'images.unsplash.com', (route) => (
    photos === 'load'
      ? route.fulfill({ path: art[n++ % art.length], contentType: 'image/jpeg' })
      : route.fulfill({ status: 404, body: '' })
  ));
  const page = await context.newPage();
  return { context, page };
}

async function dismissCookies(page) {
  const btn = page.getByText('Necessary only', { exact: true });
  if (await btn.count()) await btn.first().click().catch(() => {});
}

async function shot(page, name) {
  await dismissCookies(page);
  await page.waitForTimeout(1200);
  const file = path.join(OUT, `${PREFIX}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', path.relative(process.cwd(), file));
}

async function open(page, route) {
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.waitForTimeout(6000);
  await dismissCookies(page);
}

// A signed-in buyer's GET /api/buyer/orders, in the route's real shape
// (orderNumber BT-#####, items with the product's first photo, sellerLogoUrl).
const NOW = Date.now();
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const address = { name: 'Buyer', line1: '1 Test Street', city: 'Austin', state: 'TX', zip: '78701', country: 'US' };
const REAL_ORDERS = [
  {
    id: '3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b21', orderNumber: 'BT-00042', ownerId: 'seller_1', sellerDisplayName: 'Atelier Noire',
    sellerLogoUrl: 'https://cdn.brandthread.test/texture-mono', status: 'shipped', totalCents: 48_000, subtotalCents: 48_000, shippingCents: 0,
    trackingNumber: '1Z999AA10123456784', carrier: 'UPS', trackingStatus: 'in_transit', estimatedDelivery: daysAgo(-3),
    shippingAddress: address, createdAt: daysAgo(2), stripePaymentIntentId: 'pi_x',
    items: [{ productId: 'p1', productName: 'Sculpted Wool Coat', variantLabel: 'M', quantity: 1, priceCents: 48_000, imageUrl: 'https://cdn.brandthread.test/jacket-onyx' }],
  },
  {
    id: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', orderNumber: 'BT-00041', ownerId: 'seller_2', sellerDisplayName: 'Maison Vela',
    sellerLogoUrl: 'https://cdn.brandthread.test/texture-ember', status: 'processing', totalCents: 32_500, subtotalCents: 32_500, shippingCents: 0,
    shippingAddress: address, createdAt: daysAgo(4), stripePaymentIntentId: 'pi_y',
    items: [{ productId: null, productName: 'Liquid Silver Dress', variantLabel: 'S', quantity: 1, priceCents: 32_500, imageUrl: null }],
  },
];

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
try {
  // ── Bag ────────────────────────────────────────────────────────────────
  {
    const { context, page } = await newPage(browser, images);
    // Arrive from the orders tab so the back control has somewhere to go.
    await open(page, '/orders?bt_preview=buyer');
    await page.evaluate(() => { window.history.pushState({}, '', '/cart'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await open(page, '/cart?bt_preview=buyer');
    await shot(page, 'bag-empty');
    const back = page.getByRole('button', { name: /^(Back|Close|Go back)/i }).first();
    const box = await back.boundingBox().catch(() => null);
    console.log('bag back control:', await back.getAttribute('aria-label').catch(() => null), box && `${Math.round(box.width)}x${Math.round(box.height)}`);
    const cta = page.getByRole('button', { name: /Continue shopping|Shop Threads|Discover/i }).first();
    const ctaBox = await cta.boundingBox().catch(() => null);
    if (ctaBox) console.log('bag CTA centre offset from screen centre:', Math.round(ctaBox.x + ctaBox.width / 2 - VIEWPORT.width / 2), 'px');
    await context.close();
  }
  // ── My orders (fresh preview) ──────────────────────────────────────────
  {
    const { context, page } = await newPage(browser, images);
    await open(page, '/orders?bt_preview=buyer');
    await shot(page, 'orders-top');
    const meta = await page.getByText(/PREVIEW-|Order #/).allInnerTexts();
    console.log('order meta lines:', meta);
    const chipRow = page.getByText('Delivered', { exact: true }).first();
    await chipRow.hover();
    await page.mouse.wheel(600, 0);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('div')) {
        if (el.scrollWidth > el.clientWidth + 20 && getComputedStyle(el).overflowX !== 'visible' && el.textContent?.includes('Pre-order')) el.scrollLeft = el.scrollWidth;
      }
    });
    await shot(page, 'orders-chips-end');
    await page.getByText('Returns', { exact: true }).first().click();
    await shot(page, 'orders-returns');
    await context.close();
  }
  {
    const { context, page } = await newPage(browser, images, { photos: 'fail' });
    await open(page, '/orders?bt_preview=buyer');
    await shot(page, 'orders-photo-failed');
    await context.close();
  }
  // ── My orders, signed-in buyer (real API shape) ─────────────────────────
  {
    const { context, page } = await newPage(browser, images, { signedIn: true, buyerOrders: REAL_ORDERS });
    await open(page, '/orders?bt_preview=buyer');
    await shot(page, 'orders-real-account');
    console.log('real order meta lines:', await page.getByText(/BT-|Order #|3f2b8c1e/).allInnerTexts());
    console.log('"View Order Details" buttons:', await page.getByText('View Order Details').count());
    await page.getByText('Sculpted Wool Coat (M) × 1').click();
    await page.waitForTimeout(2500);
    console.log('tapping the card body opened:', new URL(page.url()).pathname + new URL(page.url()).search);
    await context.close();
  }
  // ── My orders, demo=1 (enough cards to reach the tab bar) ──────────────
  {
    const { context, page } = await newPage(browser, images);
    await open(page, '/orders?bt_preview=buyer&demo=1');
    await page.mouse.move(195, 500);
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(100); }
    await shot(page, 'orders-bottom');
    const overlay = await page.getByText(/cannot contain a nested/).count();
    console.log('dev overlay nested-button errors:', overlay);
    const gap = await page.evaluate(() => {
      // The floating tab bar is the lowest tablist (the filter tabs are one too).
      const tabTop = Math.max(...[...document.querySelectorAll('[role="tablist"]')].map(t => t.getBoundingClientRect().top));
      const totals = [...document.querySelectorAll('div')].filter(d => /^\$[\d,]+\.\d\d$/.test(d.textContent ?? '') && d.children.length === 0);
      const lastBottom = Math.max(...totals.map(t => {
        let card = t; for (let i = 0; i < 8 && card.parentElement; i++) { card = card.parentElement; if (getComputedStyle(card).borderTopWidth === '1px' && getComputedStyle(card).borderRadius !== '0px' && card.getBoundingClientRect().height > 150) break; }
        return card.getBoundingClientRect().bottom;
      }));
      return { tabTop, lastCardBottom: lastBottom };
    });
    console.log('last card vs tab bar:', gap);
    await context.close();
  }
} finally {
  await browser.close();
}
