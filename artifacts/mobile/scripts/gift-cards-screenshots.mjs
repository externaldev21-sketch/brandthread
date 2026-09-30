#!/usr/bin/env node
/**
 * Gift cards, live at 393x852 on the store-screenshots harness (signed-in demo
 * account, fake API). Also runs the TEXT-FIT check on every screen it opens:
 * any element whose text is wider than its box, is cut by an ellipsis, or
 * sticks out of its parent or the screen fails the run.
 *
 *   node scripts/gift-cards-screenshots.mjs <outDir> [--build]
 *
 * --build exports the preview web build first (slow); otherwise the last
 * build in .store-screenshots/web-build is served.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/gift-cards'));
mkdirSync(OUT, { recursive: true });
if (process.argv.includes('--build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

// Stripe.js stub shared with the one-page checkout screenshot script.
const onePage = readFileSync(path.join(MOBILE_ROOT, 'scripts/one-page-checkout-screenshots.mjs'), 'utf8');
const STRIPE_STUB = onePage.match(/const STRIPE_STUB = `([\s\S]*?)`;\n/)[1];

const failures = [];

/** Flags text that does not fit its box. Returns a list of offenders. */
async function textFit(page, label) {
  const offenders = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const text = el.textContent.trim().slice(0, 40);
      // Ignore text scrolled out of a scroll container's viewport.
      const reasons = [];
      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible' && style.whiteSpace === 'nowrap') reasons.push('scrollWidth>clientWidth');
      if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) reasons.push('ellipsis cut');
      // Text lines clamped by numberOfLines: compare line boxes.
      if (el.scrollHeight > el.clientHeight + 2 && style.overflowY === 'hidden') reasons.push('clipped vertically');
      if (box.left < -0.5 || box.right > vw + 0.5) reasons.push(`outside screen (${Math.round(box.left)}..${Math.round(box.right)})`);
      const parent = el.parentElement;
      if (parent) {
        const pb = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        if (ps.overflowX !== 'hidden' && ps.overflowX !== 'scroll' && ps.overflowX !== 'auto' && pb.width > 0 && (box.right > pb.right + 1 || box.left < pb.left - 1)) {
          reasons.push('sticks out of parent');
        }
      }
      if (reasons.length) out.push({ text, reasons });
    }
    return out;
  });
  if (offenders.length) failures.push({ screen: label, offenders });
  console.log(`  ${offenders.length ? '✗' : '✓'} text-fit ${label}${offenders.length ? ` ${JSON.stringify(offenders)}` : ''}`);
}

function json(route, origin, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function open(browser, origin, images, { role = 'buyer', target, seed, routes }) {
  const { context, page, activity } = await openContext(browser, { device: { viewport: VIEWPORT, scale: 2, isMobile: true }, role, origin, images });
  if (seed) {
    await context.addInitScript(([key, value]) => {
      if (sessionStorage.getItem('bt:gc-seeded')) return;
      localStorage.setItem(key, value);
      sessionStorage.setItem('bt:gc-seeded', '1');
    }, seed);
  }
  await context.route('https://js.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STRIPE_STUB }));
  if (routes) {
    await context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      const handled = await routes(route, p, request, (body, status) => json(route, origin, body, status));
      if (handled === false || handled === undefined) return route.fallback();
    });
  }
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, origin, role, target);
  await waitForQuietNetwork(activity, 900, 20_000);
  await page.waitForTimeout(1500);
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

/** Zoomed crop of one element (device scale 2 already; clip adds 12px margin). */
async function zoom(page, locator, name) {
  const box = await locator.boundingBox();
  if (!box) return;
  const clip = { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(VIEWPORT.width, box.width + 24), height: box.height + 24 };
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip, caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

async function run() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const origin = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    // 1. Buyer wallet (Menu > Gift cards), with cards and empty.
    {
      const { context, page } = await open(browser, origin, images, { target: '/buyer-gift-cards?demo=1' });
      await page.getByText('Your cards').waitFor({ timeout: 20_000 });
      await shot(page, '01-wallet-cards');
      await textFit(page, 'wallet');
      await zoom(page, page.getByText('Add a gift card').locator('xpath=ancestor::*[3]'), '01z-wallet-add-field');
      await page.getByLabel(/Atelier North gift card/).first().click();
      await page.waitForTimeout(600);
      await shot(page, '02-wallet-card-open');
      await context.close();
    }
    {
      const { context, page } = await open(browser, origin, images, { target: '/buyer-gift-cards' });
      await page.getByText('No gift cards yet').waitFor({ timeout: 20_000 });
      await shot(page, '03-wallet-empty');
      await textFit(page, 'wallet-empty');
      await context.close();
    }

    // 2. Buy flow from a store's profile menu.
    {
      const { context, page } = await open(browser, origin, images, { target: '/gift-card-buy?sellerId=preview-seller&name=Atelier%20North&demo=1' });
      await page.getByText('Recipient').first().waitFor({ timeout: 20_000 });
      await shot(page, '04-buy-top');
      await textFit(page, 'buy-top');
      await zoom(page, page.getByText('$50.00', { exact: true }).last().locator('xpath=ancestor::*[2]'), '04z-buy-amount-chips');
      await page.getByTestId('gift-card-email').fill('sam@example.com');
      await page.evaluate(() => window.scrollTo(0, 100000));
      await page.getByText('Payment').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot(page, '05-buy-recipient-payment');
      await textFit(page, 'buy-payment');
      await context.close();
    }
    {
      const { context, page } = await open(browser, origin, images, { target: '/gift-card-buy?sellerId=preview-seller&name=Field%20Supply&demo=1' });
      await page.getByText('Recipient').first().waitFor({ timeout: 20_000 });
      await context.close();
    }

    // 3. Seller: More > Store > Gift cards.
    {
      const { context, page } = await open(browser, origin, images, { role: 'seller', target: '/gift-cards-manage?demo=1' });
      await page.getByText('Sell gift cards').waitFor({ timeout: 20_000 });
      await shot(page, '06-seller-manage-top');
      await textFit(page, 'seller-top');
      await page.getByText('Issued cards').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot(page, '07-seller-issued-cards');
      await textFit(page, 'seller-cards');
      await context.close();
    }

    // 4. Menu row and More row.
    {
      const { context, page } = await open(browser, origin, images, { target: '/buyer-settings-menu' });
      await page.getByText('Gift cards').first().waitFor({ timeout: 20_000 });
      await shot(page, '08-buyer-menu-row');
      await textFit(page, 'buyer-menu');
      await context.close();
    }
    {
      const { context, page } = await open(browser, origin, images, { role: 'seller', target: '/(tabs)/more' });
      await page.getByText('Gift cards').first().waitFor({ timeout: 20_000 });
      await page.getByText('Gift cards').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot(page, '09-seller-more-row');
      await textFit(page, 'seller-more');
      await context.close();
    }

    // 5. Checkout with a gift card applied.
    {
      const session = checkoutSession();
      const firstSeller = session.deliveryGroups[0].sellerId;
      const seeded = {
        ...session, acknowledgments: [],
        shippingAddress: { firstName: 'Jordan', lastName: 'Reyes', line1: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', id: 'addr_home' },
        giftCards: { [firstSeller]: { cardId: 'gc1', last4: '4821' } },
      };
      const card = { id: 'gc1', sellerId: firstSeller, storeName: session.deliveryGroups[0].sellerName, last4: '4821', initialCents: 5000, balanceCents: 3200, status: 'active', expiresAt: null, createdAt: new Date().toISOString(), role: 'owner', recipientName: null, message: null };
      const routes = async (route, p, request, reply) => {
        if (p === '/api/config/features') return reply({ flags: { threadCash: false, hostedCheckoutFallback: false }, updatedAt: null });
        if (p === '/api/buyer/addresses') return reply([{ id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true }]);
        if (p === '/api/buyer/payment-methods') return reply({ paymentMethods: [{ id: 'pm_visa', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2029, isDefault: true }] });
        if (p === '/api/gift-cards/mine') return reply({ cards: [card], totalCents: 3200 });
        if (p === '/api/buyer/checkout/payment-intent/quote') {
          const groups = JSON.parse(request.postData() || '{}').groups ?? [];
          const all = session.deliveryGroups.flatMap(g => g.items);
          const quoted = groups.map((group, index) => {
            const subtotal = group.items.reduce((sum, item) => sum + (all.find(i => i.variantId === item.variantId)?.priceCents ?? 0) * item.quantity, 0);
            const gift = group.giftCard ? Math.min(3200, subtotal) : 0;
            return { sellerId: session.deliveryGroups[index]?.sellerId, checkoutSessionId: `cs_${index}`, subtotalCents: subtotal, shippingCents: 1200, discountCents: 0, taxCents: 0, giftCardCents: gift, totalCents: subtotal + 1200 - gift, processingDays: 2 };
          });
          return reply({ amountCents: quoted.reduce((s, g) => s + g.totalCents, 0), groups: quoted });
        }
        return false;
      };
      const { context, page } = await open(browser, origin, images, { target: '/buyer-checkout', seed: [CHECKOUT_KEY, JSON.stringify(seeded)], routes });
      await page.getByTestId('checkout-gift-card').waitFor({ timeout: 40_000 });
      const scroll = page.getByTestId('checkout-scroll');
      const toTestId = async (id, off = 70) => {
        await scroll.evaluate((el, [tid, o]) => {
          const target = el.querySelector(`[data-testid="${tid}"]`);
          if (target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - o;
        }, [id, off]);
        await page.waitForTimeout(500);
      };
      await toTestId('checkout-gift-card');
      await shot(page, '10-checkout-gift-card-applied');
      await textFit(page, 'checkout-gift-card');
      await zoom(page, page.getByTestId('checkout-gift-card'), '10z-checkout-gift-card-section');
      await toTestId('checkout-order-summary', 40);
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(600);
      await shot(page, '11-checkout-summary-gift-line');
      await textFit(page, 'checkout-summary');
      await zoom(page, page.getByTestId('checkout-price-breakdown'), '11z-checkout-price-breakdown');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(path.join(OUT, 'text-fit-results.json'), JSON.stringify({ viewport: VIEWPORT, failures }, null, 2));
  if (failures.length) {
    console.error('TEXT-FIT FAILURES', JSON.stringify(failures, null, 2));
    process.exit(2);
  }
  console.log('text-fit: all screens clean');
}

run().catch((error) => { console.error(error); process.exit(1); });
