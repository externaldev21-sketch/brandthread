#!/usr/bin/env node
/**
 * Item 107: live check of the buyer order-tracking screen at 390×844.
 *
 * Signed-in mode runs on the production web build (store-screenshots
 * harness, signed-in demo buyer). GET /api/buyer/orders/:id answers with
 * the exact row shape routes/buyer.ts returns, including this PR's
 * `paidAt`, for:
 *   in transit (UPS), out for delivery, delivered, and in transit under
 *   the Purple theme (to prove the tracker stays monochrome).
 * It also taps the carrier chip and records the URL it opens.
 *
 * Preview mode (--preview=<origin>) uses the dev bundle (`expo start --web`,
 * __DEV__ on), the local replica of the owner's Replit preview. No account
 * is signed in, so every non-public API call answers 401. It opens #294's
 * seeded preview order BT-10428 (UPS, in transit).
 *
 *   node scripts/order-tracking-screenshots.mjs [--skip-build] [--preview=http://localhost:8099]
 *
 * Output: docs/pr-review/order-tracking-107/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/order-tracking-107');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** A row exactly as GET /api/buyer/orders/:id returns it. */
function orderRow(kind) {
  const base = {
    id: '6f1c2b8e-4b7a-4c1e-9a55-2d7f3c9e1a42',
    orderNumber: 'BT-00042',
    ownerId: 'user_seller_demo',
    sellerDisplayName: 'Northline Studio',
    status: 'shipped',
    totalCents: 16000, subtotalCents: 14800, shippingCents: 1200,
    trackingNumber: '1Z999AA10123456784',
    carrier: 'UPS',
    trackingStatus: 'in_transit',
    estimatedDelivery: ymd(now + 2 * DAY),
    shippedAt: iso(now - 26 * HOUR),
    paidAt: iso(now - 3 * DAY + 90_000),
    shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
    stripePaymentIntentId: 'pi_3Q_demo',
    cancellationReason: null, cancellationNotes: null, isCustomerVisible: false,
    createdAt: iso(now - 3 * DAY),
    items: [{ productId: 'prod_hoodie', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14800, imageUrl: `${IMAGE_HOST}/product-hoodie.jpg` }],
  };
  if (kind === 'out_for_delivery') return { ...base, trackingStatus: 'out_for_delivery', estimatedDelivery: ymd(now) };
  if (kind === 'delivered') return { ...base, status: 'delivered', trackingStatus: 'delivered', estimatedDelivery: ymd(now - DAY) };
  return base;
}

let ORIGIN = '';
const cors = () => ({ 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' });

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

async function tallShot(page, name) {
  const extra = await page.evaluate(() => {
    const s = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible').sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (s) s.scrollTop = 0;
    return s ? s.scrollHeight - s.clientHeight : 0;
  });
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + extra });
  await page.waitForTimeout(500);
  await shot(page, name);
  await page.setViewportSize(VIEWPORT);
}

async function inspect(page) {
  return page.evaluate(() => {
    const txt = (id) => document.querySelector(`[data-testid="${id}"]`)?.innerText?.replace(/\s+/g, ' ').trim() ?? null;
    const steps = ['placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered'].map((k) => {
      const el = document.querySelector(`[data-testid="order-step-${k}"]`);
      return el ? `${el.getAttribute('aria-selected') === 'true' ? '▶ ' : ''}${el.innerText.replace(/\s+/g, ' ').trim()}` : null;
    });
    const map = document.querySelector('[data-testid="shipment-map-placeholder"]');
    // Every coloured (non-grey) computed colour inside the tracker card.
    const card = map?.closest('[data-testid="shipment-map-placeholder"]')?.parentElement ?? document.querySelector('[data-testid="shipment-headline"]')?.parentElement;
    const colored = new Set();
    for (const el of card ? card.querySelectorAll('*') : []) {
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke']) {
        const v = getComputedStyle(el)[prop];
        const m = v && v.match(/rgba?\((\d+), (\d+), (\d+)/);
        if (m && (Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]) > 12)) colored.add(`${prop}:${v}`);
      }
    }
    return {
      headline: txt('shipment-headline'),
      map: map ? { label: map.getAttribute('aria-label'), svg: !!map.querySelector('svg'), h: Math.round(map.getBoundingClientRect().height) } : null,
      steps,
      coloredInTracker: [...colored].slice(0, 6),
      unfulfilledText: document.body.innerText.includes('Unfulfilled'),
    };
  });
}

async function signedIn(browser, images, kind, { theme } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  if (theme) {
    await page.addInitScript(([u, t]) => { localStorage.setItem(`@brandthread/app-theme:v1:${u}`, t); localStorage.setItem('@brandthread/app-theme:v1:guest', t); }, [BUYER_USER.id, theme]);
  }
  const row = orderRow(kind);
  await context.route(`${API}/**`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === `/api/buyer/orders/${row.id}`) return route.fulfill({ status: 200, headers: cors(), contentType: 'application/json', body: JSON.stringify(row) });
    if (p.startsWith('/api/returns')) return route.fulfill({ status: 200, headers: cors(), contentType: 'application/json', body: '[]' });
    return route.fallback();
  });
  const opened = [];
  // The carrier page itself is offline in the harness; record the URL the app asked for.
  context.on('request', (r) => { if (/ups\.com|usps\.com|fedex\.com|dhl\.com/.test(r.url())) opened.push(r.url()); });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, ORIGIN, 'buyer', `/buyer-order-detail?id=${row.id}`);
    try { await page.getByText(`Order ${row.orderNumber}`).first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(900);
  const name = `${kind}${theme ? `-${theme}-theme` : ''}`;
  const info = await inspect(page);
  await page.getByTestId('shipment-headline').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible'); if (s) s.scrollTop -= 120; });
  await shot(page, `signed-in-${name}`);
  await tallShot(page, `signed-in-${name}-full`);
  if (kind === 'in_transit' && !theme) {
    const chip = page.getByLabel(/^Track package with UPS/);
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(1500);
    info.carrierLinkOpened = opened[0] ?? null;
  }
  console.log(`  [${name}]`, JSON.stringify(info));
  await context.close();
}

async function preview(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await context.route((url) => url.origin === API && !/^\/api(\/v1)?\/public\//.test(url.pathname), (route) => {
    const req = route.request();
    const h = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    return route.fulfill({ status: 401, headers: h, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  page.setDefaultNavigationTimeout(240_000);
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-order-detail?id=preview-order-01&bt_preview=buyer');
    try { await page.getByText('Order BT-10428').first().waitFor({ timeout: 60_000 }); break; } catch (e) { if (attempt >= 2) throw e; }
  }
  await waitForQuietNetwork(activity, 500, 10_000).catch(() => {});
  await page.waitForTimeout(2500);
  const info = await inspect(page);
  await page.getByTestId('shipment-headline').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible'); if (s) s.scrollTop -= 120; });
  await shot(page, 'preview-BT-10428-in-transit');
  await page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible'); if (s) s.scrollTop = 0; });
  await shot(page, 'preview-BT-10428-top');
  console.log('  [preview BT-10428]', JSON.stringify(info));
  await context.close();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const previewOrigin = process.argv.find((a) => a.startsWith('--preview='))?.slice(10);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    if (previewOrigin) {
      await preview(browser, images, previewOrigin);
      return;
    }
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    const server = await serveBuild(DEFAULT_BUILD_DIR);
    ORIGIN = server.origin;
    try {
      await signedIn(browser, images, 'in_transit');
      await signedIn(browser, images, 'out_for_delivery');
      await signedIn(browser, images, 'delivered');
      await signedIn(browser, images, 'in_transit', { theme: 'purple' });
    } finally {
      server.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
