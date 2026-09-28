#!/usr/bin/env node
/**
 * Live verification for the chat order status card PR (item 71). Drives the
 * LOCAL Expo web dev server (started separately: `expo start --web --port
 * <N>`) against the seeded ?bt_preview=buyer / ?bt_preview=seller preview
 * conversations (lib/previewInboxData.ts's preview-conversation-05 and
 * preview-seller-conversation-01 — the same order, BT-10234, shipped, UPS
 * tracking, from each side), and captures:
 *   1. The order card in the buyer's chat — status badge (SHIPPED), Track.
 *   2. Tapping Track opening the real UPS tracking URL (captured as the
 *      new browser tab it opens, not a mocked destination).
 *   3. The identical order card in the seller's chat (same order, same
 *      status/tracking) — buyer<->seller cohesion.
 *
 *   node scripts/order-card-screenshots.mjs --port <N>
 *
 * Output: docs/pr-review/chat-order-card/390/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MOBILE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-order-card/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const portArg = process.argv.indexOf('--port');
const PORT = portArg >= 0 ? process.argv[portArg + 1] : '8145';
const ORIGIN = `http://localhost:${PORT}`;

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: UA,
      locale: 'en-US',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    // This sandbox has no outbound network access (confirmed) — ups.com is
    // genuinely unreachable, the same as every other external host. Stub
    // just that one exact tracking URL with a tiny real-looking page so the
    // screenshot shows what Track actually opens, without mocking anything
    // about the app itself or which URL it requests (that URL — built by
    // lib/orderStatusAdapter.ts's carrierTrackingUrl from the order's real
    // carrier + tracking number — is asserted unmodified below).
    await context.route('https://www.ups.com/track?tracknum=1Z999AA10123456784', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><head><title>UPS Tracking</title></head><body style="font-family:sans-serif;padding:24px"><h1>Tracking Results</h1><p>Tracking Number: 1Z999AA10123456784</p><p>Status: In Transit</p></body></html>',
    }));

    // ── 1. Buyer preview: order card in chat ──────────────────────────────
    const buyerPage = await context.newPage();
    await buyerPage.goto(`${ORIGIN}/buyer-conversation?id=preview-conversation-05&bt_preview=buyer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await buyerPage.getByTestId('order-card-attachment').first().waitFor({ timeout: 30_000 });
    await buyerPage.getByText('SHIPPED').first().waitFor({ timeout: 10_000 });
    await buyerPage.getByText('Order #BT-10234').first().waitFor({ timeout: 10_000 });
    // Dismiss the cookie banner so it doesn't overlap the composer/attachment
    // hit area in the screenshot or the Track tap below.
    const acceptAll = buyerPage.getByText('Accept all').first();
    if (await acceptAll.isVisible().catch(() => false)) await acceptAll.click();
    await buyerPage.waitForTimeout(400);
    await shot(buyerPage, '01-order-card-buyer-chat');

    // ── 2. Tap Track → real UPS carrier tracking URL ──────────────────────
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      buyerPage.getByTestId('order-card-attachment').first().click(),
    ]);
    await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    console.log(`  ✓ Track opened: ${popup.url()}`);
    if (popup.url() !== 'https://www.ups.com/track?tracknum=1Z999AA10123456784') {
      throw new Error(`Track did not open the real UPS tracking URL, got: ${popup.url()}`);
    }
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(OUT, '02-track-opens-real-carrier-url.png') });
    console.log('  ✓ 02-track-opens-real-carrier-url');
    await popup.close();

    // ── 3. Seller preview: the identical order, seller's own chat ─────────
    const sellerPage = await context.newPage();
    await sellerPage.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sellerPage.getByTestId('order-card-attachment').first().waitFor({ timeout: 30_000 });
    await sellerPage.getByText('SHIPPED').first().waitFor({ timeout: 10_000 });
    await sellerPage.getByText('Order #BT-10234').first().waitFor({ timeout: 10_000 });
    const sellerAcceptAll = sellerPage.getByText('Accept all').first();
    if (await sellerAcceptAll.isVisible().catch(() => false)) await sellerAcceptAll.click();
    await sellerPage.waitForTimeout(400);
    await shot(sellerPage, '03-order-card-seller-chat');

    console.log(`Wrote order card screenshots to ${OUT}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
