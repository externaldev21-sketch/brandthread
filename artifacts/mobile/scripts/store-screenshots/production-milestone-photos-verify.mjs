/**
 * Production-milestone photo updates verification: the seller's tracker
 * (production-detail.tsx) renders an "Updates from the factory" section
 * with inline thumbnails for same-stage events that carry photos/notes,
 * additively alongside the existing six-stage timeline. 393x852, seller role.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, openContext, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { IMAGE_HOST, SAMPLE_ORDERS } from './demo-data.mjs';
import { assertNoTextOverflow } from './checkTextOverflow.mjs';

// production-detail.tsx validates the order id against a UUID shape before
// ever calling the timeline endpoint (see manufacturerOrderFlow.ts's
// assertOrderId) — the demo fixture ids ("so-2") aren't UUIDs, so this
// screen needs its own well-formed id rather than reusing one verbatim.
const ORDER_ID = '4f6a2b1e-8c3d-4e2a-9b7f-1a2b3c4d5e6f';

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), '.production-milestone-photos-screenshots');
mkdirSync(OUT_DIR, { recursive: true });
const VIEWPORT = { width: 393, height: 852 };

function timelineWithPhotoUpdates(order) {
  const now = new Date();
  const iso = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return {
    viewerRole: 'seller',
    order: {
      id: ORDER_ID, orderType: order.orderType, title: order.title, description: order.description ?? null,
      quantity: order.quantity, priceCents: order.priceCents, currency: 'usd', status: 'cut_and_sew',
      issuedBy: 'manufacturer', carrier: null, trackingNumber: null,
      paymentReviewState: 'none', manufacturerPayoutReady: true, revision: order.revision ?? 1, updatedAt: now.toISOString(),
    },
    manufacturer: { id: order.manufacturerId, businessName: order.manufacturerName, country: 'Vietnam', timeZone: 'Asia/Ho_Chi_Minh' },
    steps: [
      { stage: 'payment_received', label: 'Payment received', description: 'You paid for this order.', state: 'done', at: iso(4320) },
      { stage: 'processing', label: 'Processing', description: 'The factory is preparing materials.', state: 'done', at: iso(2880) },
      { stage: 'cut_and_sew', label: 'Cut & sew', description: 'Cutting and sewing your pieces.', state: 'current', at: iso(1440) },
      { stage: 'packing', label: 'Packing', description: 'Quality check and packing.', state: 'upcoming', at: null },
      { stage: 'shipped', label: 'Shipped', description: 'On its way to you.', state: 'upcoming', at: null },
      { stage: 'delivered', label: 'Delivered', description: 'Arrived.', state: 'upcoming', at: null },
    ],
    events: [
      { id: 'evt-1', actorRole: 'manufacturer', fromStatus: 'processing', toStatus: 'processing', note: null, imageUrls: [], createdAt: iso(2880) },
      {
        id: 'evt-2', actorRole: 'manufacturer', fromStatus: 'cut_and_sew', toStatus: 'cut_and_sew',
        note: 'Cutting complete on all panels, moving to sewing today.',
        imageUrls: [`${IMAGE_HOST}/demo/texture-ember.jpg`, `${IMAGE_HOST}/demo/hoodie-ember.jpg`],
        createdAt: iso(600),
      },
      {
        id: 'evt-3', actorRole: 'manufacturer', fromStatus: 'cut_and_sew', toStatus: 'cut_and_sew',
        note: 'First finished pieces off the line — colour and stitch match approved samples.',
        imageUrls: [`${IMAGE_HOST}/demo/hoodie-graphite.jpg`],
        createdAt: iso(90),
      },
    ],
    createdAt: iso(4320),
    paidAt: iso(4320),
    tracking: { carrier: null, carrierName: null, trackingNumber: null, url: null },
  };
}

async function main() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(process.cwd(), '.store-screenshots', 'demo-images'));
    const order = SAMPLE_ORDERS.find((o) => o.orderType === 'sample') ?? SAMPLE_ORDERS[0];
    const fixture = timelineWithPhotoUpdates(order);

    const { context, page, activity } = await openContext(browser, {
      device: { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined },
      role: 'seller', origin: server.origin, images,
      onUnseeded: () => {},
    });
    // Overrides the harness's own timeline fixture for this one order id —
    // Playwright runs the most-recently-added route handler first.
    await context.route('**/manufacturers/orders/*/timeline', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
    }));

    // A full navigation straight to the target route (rather than the
    // load-root-then-pushState two-step openScreen() does) so this capture
    // never touches "/" — root's own redirect-away effect for a seller is a
    // different screen and only adds a timing race against it.
    await page.goto(`${server.origin}/production-detail?id=${encodeURIComponent(ORDER_ID)}&bt_preview=seller`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
    await waitForQuietNetwork(activity, 500, 8000).catch(() => {});
    await waitForImages(page);
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(OUT_DIR, '01-production-detail-photo-updates.png') });
    console.log('captured production-detail with milestone photo updates');

    await assertNoTextOverflow(page, { rootSelector: '[data-testid="tracker-updates"]' });
    await assertNoTextOverflow(page, { rootSelector: '[data-testid="production-timeline"]' });
    console.log('no text/box overflow on the updates section or timeline');

    const updatesHandle = await page.$('[data-testid="tracker-updates"]');
    if (updatesHandle) await updatesHandle.screenshot({ path: path.join(OUT_DIR, '02-updates-section-zoom.png') });
    const timelineHandle = await page.$('[data-testid="production-timeline"]');
    if (timelineHandle) await timelineHandle.screenshot({ path: path.join(OUT_DIR, '03-timeline-zoom.png') });

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
