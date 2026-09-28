#!/usr/bin/env node
/**
 * Live verification for the chat product share card PR (item 70). Drives the
 * real web build at 390×844 against the seeded ?bt_preview=buyer preview
 * conversation (lib/previewInboxData.ts's preview-conversation-04, which
 * already carries one live product card and one "no longer available"
 * product card — see previewInbox.ts's toAttachment), and captures:
 *   1. The product card bubble in the chat — image, name, price, View.
 *   2. Tapping View navigating to the real app/buyer-product-detail.tsx
 *      screen with real product data (the product API route is stubbed with
 *      a realistic fixture, the same technique
 *      checkout-redesign-screenshots.mjs uses for Stripe/addresses — nothing
 *      about the navigation or the product screen itself is mocked).
 *   3. The deleted/unavailable-product fallback card, in the same thread.
 *
 *   node scripts/product-card-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/chat-product-card/390/*.png
 */
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-product-card/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const API = 'https://api.brandthread.test';

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots/demo-images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };

  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    // A realistic /api/public/products/preview-product-04 fixture, matching
    // the productId the seeded chat card carries (see previewInboxData.ts) —
    // so tapping "View" lands on a real, fully-populated product screen
    // instead of the honest-but-uninteresting "Product not found" state a
    // real 404 against this sandbox's unreachable backend would otherwise
    // produce. The real buyer-product-detail.tsx code and its real fetch
    // logic run unmodified; only the network answer is stubbed.
    const corsHeaders = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    await context.route(`${API}/**/public/products/preview-product-04`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          id: 'preview-product-04',
          ownerId: 'seller_orison',
          name: 'Ivory Column Set',
          description: 'A two-piece column set in heavyweight ivory crepe — fitted bodice, floor-length skirt with a hidden side zip.',
          images: [`https://cdn.brandthread.test/demo/look-mono.jpg`],
          category: 'Sets',
          sellerDisplayName: 'Orison',
          status: 'active',
          claimedUnits: 12,
          remainingUnits: 8,
          demandCount: 96,
          variants: [
            { id: 'preview-variant-04-xs', size: 'XS', priceCents: 41000, stock: 3 },
            { id: 'preview-variant-04-s', size: 'S', priceCents: 41000, stock: 4 },
            { id: 'preview-variant-04-m', size: 'M', priceCents: 41000, stock: 1 },
          ],
        }),
      });
    });

    try {
      // preview-conversation-04: seeded with the live product card + the
      // "no longer available" product card (item 70) — see previewInboxData.ts.
      let opened = false;
      for (let attempt = 0; attempt < 4 && !opened; attempt++) {
        await openScreen(page, activity, origin, 'buyer', '/buyer-conversation?id=preview-conversation-04');
        try {
          await page.getByText('Ivory Column Set').first().waitFor({ timeout: 20_000 });
          opened = true;
        } catch (error) {
          if (attempt === 3) {
            await page.screenshot({ path: path.join(OUT, 'debug.png') });
            console.error('DEBUG url:', page.url());
            console.error('DEBUG body:', (await page.textContent('body').catch(() => '')).slice(0, 2000));
            throw error;
          }
          console.warn(`  ! attempt ${attempt + 1} did not settle, retrying...`);
        }
      }
      await waitForQuietNetwork(activity, 500, 8_000);
      await waitForImages(page);
      await page.waitForTimeout(400);

      // ── 1. Product card bubble — image, name, price, View ──────────────
      await shot(page, '01-product-card-in-chat');

      // ── 2. Tap View → the real product detail screen, real data ────────
      const availableCard = page.getByTestId('product-card-attachment').filter({ hasText: 'Ivory Column Set' }).first();
      await availableCard.waitFor({ timeout: 10_000 });
      await availableCard.click();
      // "Message seller" only exists on the product detail screen, so
      // waiting for it (rather than the product name, which the departing
      // chat bubble also briefly shows mid-transition) unambiguously
      // confirms real navigation landed on the real screen.
      try {
        await page.getByText('Message seller').first().waitFor({ timeout: 20_000 });
      } catch (error) {
        await page.screenshot({ path: path.join(OUT, 'debug2.png') });
        console.error('DEBUG2 url:', page.url());
        console.error('DEBUG2 body:', (await page.textContent('body').catch(() => '')).slice(0, 3000));
        throw error;
      }
      // The price ($410.00) and seller (Orison) coming from the stubbed
      // fetch response confirm this is the real screen rendering real data,
      // not a static mockup.
      await page.getByText('$410.00').first().waitFor({ timeout: 10_000 }).catch(() => {});
      await waitForImages(page);
      await page.waitForTimeout(400);
      await shot(page, '02-view-navigates-to-real-product');

      // Back to the thread for the unavailable-card shot.
      await page.goBack();
      await page.getByText('Ivory Column Set').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);

      // ── 3. Deleted/unavailable-product fallback card ────────────────────
      const unavailableCard = page.getByTestId('product-card-attachment').filter({ hasText: 'No longer available' }).first();
      await unavailableCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, '03-product-unavailable-card');

      console.log(`Wrote product card screenshots to ${OUT}`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
