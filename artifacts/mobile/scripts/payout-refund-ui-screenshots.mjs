#!/usr/bin/env node
/**
 * Screenshots for "Held until delivery" (payouts + finance, seller preview
 * with demo=1) and the buyer refund request (shipped order: photo upload in
 * progress; unshipped order: cancel-and-refund route) at 393x852, saved to
 * screenshots/revenue-p1/payout-refund-ui/.
 *
 *   node scripts/payout-refund-ui-screenshots.mjs   (SKIP_BUILD=1 reuses the last export)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'screenshots', 'revenue-p1', 'payout-refund-ui');
mkdirSync(OUTPUT_DIR, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function shot(page, name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
  console.log('  saved', name);
}

function buyerOrder(id, status, extra = {}) {
  return {
    id, orderNumber: id === 'ord-shipped' ? 'BT-2041' : 'BT-2057', sellerId: 'seller', sellerName: 'Northside Studio',
    sellerHandle: '@northside', status, paymentStatus: 'paid',
    fulfillmentStatus: status === 'shipped' ? 'fulfilled' : 'unfulfilled',
    lineItems: [{ productName: 'Heavyweight hoodie', variant: 'Black / M', quantity: 1, unitPriceCents: 6800 }],
    shippingAddress: { name: 'Jordan Reyes', line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
    payment: { subtotalCents: 6800, shippingTotalCents: 600, taxTotalCents: 0, totalCents: 7400 },
    isPreOrder: false, hasReturnRequest: false, createdAt: '2026-10-01T15:00:00.000Z', ...extra,
  };
}

async function run() {
  if (!process.env.SKIP_BUILD) buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(WORK_DIR, 'web-build'));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    // ── Seller: payouts + finance with demo=1 ──
    // Signed-out seller preview (no Clerk stub): payouts.tsx on dev only takes
    // its preview path when no account is signed in; a stubbed signed-in
    // preview lands on "Owner access required" (fixed separately in PR #763).
    for (const target of ['/payouts', '/finance']) {
      const context = await browser.newContext({
        viewport: DEVICE.viewport, deviceScaleFactor: DEVICE.scale, isMobile: true, hasTouch: true,
        userAgent: DEVICE.userAgent, locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce',
      });
      await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
      const page = await context.newPage();
      await page.goto(`${origin}${target}?bt_preview=seller&demo=1`);
      const row = page.getByTestId('held-for-delivery').first();
      await row.waitFor({ timeout: 30_000 }).catch(async () => { await shot(page, `debug${target.replace('/', '-')}`); throw new Error(`no held row on ${target}`); });
      await page.getByText('Necessary only').first().click({ timeout: 3_000 }).catch(() => {});
      if (target === '/finance') await row.scrollIntoViewIfNeeded();
      await shot(page, target === '/payouts' ? 'payouts-demo' : 'finance-demo');
      await context.close();
    }

    // ── Buyer: refund request ──
    const orders = [
      buyerOrder('ord-shipped', 'shipped', { trackingNumber: '1Z999AA10123456784' }),
      buyerOrder('ord-processing', 'processing'),
    ];
    const seed = JSON.stringify(orders);
    {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
      await context.addInitScript((value) => {
        for (const uid of ['anon', 'user_jordan']) localStorage.setItem(`buyer_orders:${uid}:v2`, value);
      }, seed);
      // Hold the evidence upload open so the per-photo spinner is visible.
      await page.route('**/returns/evidence', () => new Promise(() => {}));
      // The harness's client-side navigation occasionally loses the race with
      // the post-sign-in remount; retry it.
      const go = async (target, text) => {
        for (let attempt = 1; ; attempt++) {
          await openScreen(page, activity, origin, 'buyer', target);
          try { await page.getByText(text).first().waitFor({ timeout: 15_000 }); return; } catch (error) {
            if (attempt >= 3) throw error;
          }
        }
      };
      await go('/buyer-refund-request?orderId=ord-shipped', 'Add photo evidence');
      await page.getByText('Necessary only').first().click({ timeout: 3_000 }).catch(() => {});
      await shot(page, 'refund-shipped');
      const photo = Object.values(images)[0];
      const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
      await page.getByText('Add photo evidence').first().click();
      await (await chooser).setFiles(photo);
      await page.getByTestId('refund-evidence-0').waitFor({ timeout: 10_000 });
      await page.getByText('Item damaged').first().click();
      await page.getByPlaceholder(/Provide as much detail/).fill('The zipper arrived broken.');
      page.on('dialog', (dialog) => { console.log('  dialog:', dialog.message()); void dialog.dismiss(); });
      await page.waitForTimeout(500);
      await page.getByText('Submit Refund Request').first().click();
      await page.getByLabel('Uploading photo').first().waitFor({ timeout: 10_000 }).catch(() => console.log('  (no uploading state seen)'));
      await page.getByTestId('refund-evidence-0').scrollIntoViewIfNeeded();
      await shot(page, 'refund-shipped-uploading');
      await go('/buyer-refund-request?orderId=ord-processing', 'Cancel order and refund');
      await shot(page, 'refund-unshipped-cancel');
      await context.close();
    }
  } finally {
    await browser.close();
    await close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
