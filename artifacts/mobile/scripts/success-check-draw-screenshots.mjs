#!/usr/bin/env node
/**
 * Item 100 — live capture of the order-success checkmark draw-in at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer,
 * fake API) straight onto the checkout's confirmation step and records:
 *   - a frame strip of the hero while the ring + check draw in
 *   - the ring/check strokeDashoffset sampled every animation frame in-page
 *     (numeric proof the stroke actually animates 100% → 0%)
 *   - the settled full screen, and the reduced-motion end state
 *
 *   node scripts/success-check-draw-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/success-check-draw-100/
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/success-check-draw-100');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

function confirmedSession() {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  group.availableMethods = [{ id: group.selectedMethodId, carrier: 'Seller shipping', service: 'Standard', priceCents: 1200, estimatedDays: 5, estimatedDelivery: 'Arrives in 4–6 business days', trackingIncluded: true, isRecommended: true }];
  const subtotalCents = group.items[0].priceCents;
  return {
    ...base,
    deliveryGroups: [group],
    isBuyNow: true,
    acknowledgments: [],
    summary: { ...base.summary, subtotalCents, shippingTotalCents: 1200, totalCents: subtotalCents + 1200 },
    step: 'confirmation',
    paidGroups: { [group.sellerId]: { stripeSessionId: 'cs_demo', orderId: 'order_demo_1', orderNumber: 'BT-00042', amountTotalCents: subtotalCents + 1200 } },
  };
}

async function openConfirmation(browser, images, origin, { reducedMotion }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  // Sample both strokes every animation frame from the moment the mark mounts.
  await page.addInitScript(() => {
    window.__drawSamples = [];
    const tick = () => {
      const svg = document.querySelector('[data-testid="checkout-success-check"] svg');
      if (svg) {
        const [circle] = svg.getElementsByTagName('circle');
        const [pathEl] = svg.getElementsByTagName('path');
        const read = (el) => Number(el?.getAttribute('stroke-dashoffset') ?? el?.style?.strokeDashoffset ?? NaN);
        window.__drawSamples.push({ t: performance.now(), ring: read(circle), check: read(pathEl) });
      }
      if (window.__drawSamples.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const session = confirmedSession();
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-checkout?source=buynow', {
      beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(session)]),
    });
    try {
      await page.getByTestId('checkout-success-check').first().waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
  }
  return { context, page };
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    // 1. Motion on: frame strip of the hero as it draws.
    {
      const { context, page } = await openConfirmation(browser, images, server.origin, { reducedMotion: false });
      const box = await page.getByTestId('checkout-success-check').first().boundingBox();
      const clip = { x: 0, y: Math.max(0, box.y - 24), width: VIEWPORT.width, height: box.height + 48 };

      for (let i = 0; i < 22; i++) {
        // Back-to-back captures (each takes ~35ms of wall time, so these are an
        // ordered strip, not exact timestamps — stroke-trace.json has the timing).
        await page.screenshot({ path: path.join(OUT, `frame-${String(i).padStart(2, "0")}.jpg`), type: "jpeg", quality: 85, clip });
      }
      await page.waitForTimeout(1200);
      await waitForImages(page);
      await page.screenshot({ path: path.join(OUT, '01-success-settled.jpg'), type: 'jpeg', quality: 82 });
      const samples = await page.evaluate(() => window.__drawSamples);
      const t0 = samples[0]?.t ?? 0;
      const trace = samples.map((s) => ({ ms: Math.round(s.t - t0), ring: Math.round(s.ring * 10) / 10, check: Math.round(s.check * 10) / 10 }));
      writeFileSync(path.join(OUT, 'stroke-trace.json'), JSON.stringify(trace, null, 1));
      const first = trace[0];
      const last = trace[trace.length - 1];
      const done = trace.find((s) => s.ring === 0 && s.check === 0);
      console.log(`  motion: ${trace.length} frames sampled; first ring=${first?.ring} check=${first?.check}; settled at ${done?.ms}ms; last ring=${last?.ring} check=${last?.check}`);
      await context.close();
    }
    // 2. Reduced motion: finished mark from the first frame.
    {
      const { context, page } = await openConfirmation(browser, images, server.origin, { reducedMotion: true });
      const samples = await page.evaluate(() => window.__drawSamples);
      console.log(`  reduced motion: first sample ring=${samples[0]?.ring} check=${samples[0]?.check}`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, '02-success-reduced-motion.jpg'), type: 'jpeg', quality: 82 });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
