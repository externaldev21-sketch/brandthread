/**
 * Seller "Ask to cancel this order" flow on a paid sample/bulk card
 * (production-detail.tsx → cancel-request.tsx → tracker shows the request),
 * plus the refunded / declined tracker states. 393x852, seller role.
 *   node scripts/store-screenshots/b2b-cancel-request-shots.mjs <outDir> [buildDir] [prefix]
 * Pass a "before" build dir to capture the unchanged tracker for comparison.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { assertNoTextOverflow } from './checkTextOverflow.mjs';

const ORDER_ID = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OUT_DIR = path.resolve(process.argv[2] ?? '.b2b-cancel-request-screenshots');
const BUILD_DIR = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_BUILD_DIR;
const PREFIX = process.argv[4] ?? '';
mkdirSync(OUT_DIR, { recursive: true });
const VIEWPORT = { width: 393, height: 852 };

function timeline(overrides = {}) {
  const now = Date.now();
  const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
  return {
    viewerRole: 'seller',
    order: {
      id: ORDER_ID, orderType: 'bulk', title: 'Heavyweight hoodie, washed black', description: 'Accepted quote: US$12.50 per piece · Turnaround 30 days',
      quantity: 200, priceCents: 250_000, currency: 'USD', status: 'payment_received', issuedBy: 'manufacturer',
      carrier: null, trackingNumber: null, paymentReviewState: 'none', manufacturerPayoutReady: true, revision: 2,
      updatedAt: iso(30), refundedCents: 0, cancelRequestState: 'none', cancelRequestReason: null,
      ...overrides,
    },
    manufacturer: { id: 'mfr-1', businessName: 'Saigon Knit Co.', country: 'Vietnam', timeZone: 'Asia/Ho_Chi_Minh' },
    steps: [
      { stage: 'payment_received', label: 'Payment received', description: 'Payment is secured. The manufacturer can start work.', state: overrides.status === 'refunded' ? 'upcoming' : 'current', at: iso(60) },
      { stage: 'processing', label: 'Processing', description: 'Materials are being sourced.', state: 'upcoming', at: null },
      { stage: 'cut_and_sew', label: 'Cut & sew', description: 'Cutting and sewing.', state: 'upcoming', at: null },
      { stage: 'packing', label: 'Packing', description: 'Quality check and packing.', state: 'upcoming', at: null },
      { stage: 'shipped', label: 'Shipped', description: 'Handed to the carrier.', state: 'upcoming', at: null },
      { stage: 'delivered', label: 'Delivered', description: 'The order arrived.', state: 'upcoming', at: null },
    ],
    events: [],
    createdAt: iso(240),
    paidAt: iso(60),
    tracking: { carrier: null, carrierName: null, trackingNumber: null, url: null },
  };
}

async function main() {
  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(process.cwd(), '.store-screenshots', 'demo-images'));
    let fixture = timeline();
    const { context, page, activity } = await openContext(browser, {
      device: { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined },
      role: 'seller', origin: server.origin, images, onUnseeded: () => {},
    });
    // The export build treats a persisted user_role=seller as the signed-out
    // seller preview (which blocks every API call). Keep the signed-in seller
    // session real for this capture by not persisting that flag.
    await context.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === 'user_role') return; return set.call(this, key, value); };
      try { localStorage.removeItem('user_role'); } catch {}
    });
    const cors = {
      'access-control-allow-origin': server.origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    await context.route('**/manufacturers/orders/*/timeline', (route) => (route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fixture) })));
    await context.route('**/sample-orders/*/cancel-request', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const body = JSON.parse(route.request().postData() || '{}');
      fixture = timeline({ cancelRequestState: 'requested', cancelRequestReason: body.reason ?? null });
      return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: JSON.stringify(fixture.order) });
    });

    if (process.env.DEBUG_SHOTS) { page.on('response', (r) => { if (r.url().includes('api.brandthread')) console.log('RES', r.status(), r.request().method(), r.url()); }); page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300))); }
    const open = async (url) => {
      await page.goto(`${server.origin}${url}`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
      await waitForQuietNetwork(activity, 500, 8000).catch(() => {});
      await page.waitForTimeout(700);
    };
    const shot = async (name, full = false) => {
      if (full) await page.setViewportSize({ width: 393, height: 1500 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}${name}.png`) });
      if (full) await page.setViewportSize(VIEWPORT);
      console.log('captured', `${PREFIX}${name}`);
    };

    await open(`/production-detail?id=${ORDER_ID}`);
    await shot('01-tracker-paid');
    await shot('01b-tracker-paid-full', true);
    if (PREFIX) return; // "before" build: the unchanged tracker only

    await page.getByTestId('tracker-request-cancel').click();
    await page.waitForTimeout(1200);
    await shot('02-cancel-request');
    await page.getByTestId('cancel-request-reason').fill('We changed the colorway. Can we cancel before you start cutting?');
    await shot('03-cancel-request-filled');
    await assertNoTextOverflow(page, {});
    await page.getByTestId('cancel-request-submit').click();
    await page.waitForTimeout(2000);
    await waitForQuietNetwork(activity, 500, 8000).catch(() => {});
    await shot('04-tracker-cancel-pending', true);

    fixture = timeline({ cancelRequestState: 'declined', cancelRequestReason: 'We changed the colorway.' });
    await open(`/production-detail?id=${ORDER_ID}`);
    await shot('05-tracker-cancel-declined', true);

    fixture = timeline({ status: 'refunded', cancelRequestState: 'approved', refundedCents: 250_000 });
    await open(`/production-detail?id=${ORDER_ID}`);
    await shot('06-tracker-refunded', true);
    await assertNoTextOverflow(page, { rootSelector: '[data-testid="tracker-refunded"]' });
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
