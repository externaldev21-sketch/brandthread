#!/usr/bin/env node
/**
 * F7 intl (#107 currency display, #108 calculated shipping, #109 duties)
 * screenshots at 393x852 @2x from an exported preview web build.
 *
 *   node scripts/f7-intl-screenshots.mjs --build-dir <dir> --tag before|after [--only a,b]
 *
 * Build with EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY set to any pk_test_ value:
 * Stripe.js is stubbed below so checkout takes the in-app path and shows the
 * server quote's breakdown. The fake API turns every flag ON (FX rates,
 * live rates, duties) — on a `before` build of dev the same answers show
 * what dev renders for them, i.e. nothing new.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TAG = arg('--tag') ?? 'after';
const BUILD_DIR = path.resolve(arg('--build-dir') ?? path.join(WORK_DIR, `web-build-intl-${TAG}`));
const OUT = path.resolve(arg('--out') ?? path.join(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'f7', 'intl'));
const ONLY = (arg('--only') ?? '').split(',').filter(Boolean);
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

const RATES = { USD: 1, AUD: 1.5021, CAD: 1.3712, CHF: 0.8047, EUR: 0.9187, GBP: 0.7702, JPY: 149.36, MXN: 18.42, SEK: 10.48 };

const INTL_ZONE = {
  id: 'zone_intl', sellerId: 'seller', name: 'International', zoneType: 'rest_of_world', countries: [],
  // dev's server never stores 'calculated', so the `before` shot edits the same zone as flat-rate.
  pricingModel: TAG === 'before' ? 'flat' : 'calculated', flatRateCents: 2500, freeAboveCents: null, processingDays: 3, carrierLabel: null,
  shipsInternationally: true, dutiesHandling: 'ddp', active: true, sortOrder: 1, weightTiers: [],
};
const DOMESTIC_ZONE = {
  id: 'zone_dom', sellerId: 'seller', name: 'Domestic', zoneType: 'domestic', countries: [],
  pricingModel: 'flat', flatRateCents: 600, freeAboveCents: 15000, processingDays: 2, carrierLabel: 'USPS Priority',
  shipsInternationally: true, dutiesHandling: 'dap', active: true, sortOrder: 0, weightTiers: [],
};

/** Minimal Stripe.js stand-in: enough for loadStripe() to resolve and Elements to mount. */
const STRIPE_STUB = `
  (function () {
    function element() { return { mount() {}, unmount() {}, destroy() {}, on() { return this; }, off() {}, update() {}, focus() {}, blur() {}, clear() {}, collapse() {} }; }
    window.Stripe = function () {
      return {
        elements() { return { create: element, getElement() { return null; }, update() {}, fetchUpdates() { return Promise.resolve({}); }, submit() { return Promise.resolve({}); } }; },
        paymentRequest() { return { canMakePayment() { return Promise.resolve(null); }, on() {}, off() {}, update() {}, show() {} }; },
        confirmPayment() { return Promise.resolve({}); },
        confirmCardPayment() { return Promise.resolve({}); },
        retrievePaymentIntent() { return Promise.resolve({}); },
        _registerWrapper() {},
        registerAppInfo() {},
      };
    };
    window.Stripe.version = 3;
  })();
`;

async function json(context, origin, pattern, body) {
  await context.route(pattern, (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const value = typeof body === 'function' ? body(req) : body;
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
  });
}

async function setupCommon(context, origin, { currency = 'EUR' } = {}) {
  await json(context, origin, /\/fx\/rates/, { enabled: true, available: true, base: 'USD', date: '2026-10-12', rates: RATES, fetchedAt: '2026-10-13T00:00:00Z' });
  await json(context, origin, /\/fx\/display-currency/, (req) => (req.method() === 'PATCH' ? JSON.parse(req.postData() || '{}') : { displayCurrency: currency }));
  if (currency) await context.addInitScript((code) => { localStorage.setItem('display_currency:v1', code); }, currency);
}

async function go(page, activity, origin, role, target, extraQuery = '&demo=1', readyTestId = null) {
  await openScreen(page, activity, origin, role, target, { extraQuery });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(1500);
    const onTarget = await page.evaluate((p) => location.pathname === p, target.split('?')[0]);
    if (onTarget && (!readyTestId || await page.getByTestId(readyTestId).first().isVisible().catch(() => false))) break;
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}${extraQuery}`);
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(600);
}

const scrollTo = (page, testId) => page.getByTestId(testId).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});

const SHOTS = {
  'currency-picker': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await setupCommon(context, origin);
    await go(page, activity, origin, 'buyer', '/currency', '&demo=1', 'currency-EUR');
  } },
  'buyer-settings': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await setupCommon(context, origin);
    await go(page, activity, origin, 'buyer', '/buyer-settings');
    await page.getByText('Shopping preferences').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await page.waitForTimeout(400);
  } },
  'product-detail': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await setupCommon(context, origin);
    await go(page, activity, origin, 'buyer', '/buyer-product-detail?productId=prod_nl_hoodie_ember');
  } },
  cart: { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await setupCommon(context, origin);
    await go(page, activity, origin, 'buyer', '/cart', '&demo=1', 'cart-order-summary');
    await scrollTo(page, 'cart-order-summary');
    await page.waitForTimeout(400);
  } },
  'checkout-duties': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await setupCommon(context, origin);
    await context.route(/js\.stripe\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STRIPE_STUB }));
    // Ship to London so a DDP zone applies.
    await context.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('bt:checkout:')) continue;
        const session = JSON.parse(localStorage.getItem(key));
        session.shippingAddress = { ...session.shippingAddress, line1: '1 Belgrave Road', line2: '', city: 'London', state: 'London', postalCode: 'SW1V 1QX', country: 'GB' };
        localStorage.setItem(key, JSON.stringify(session));
      }
    });
    await json(context, origin, /\/payment-intent\/quote/, (req) => {
      const body = JSON.parse(req.postData() || '{}');
      const groups = (body.groups ?? []).map((group, i) => {
        const subtotal = 9800 + (i === 0 ? 22000 : 16500 - 9800);
        const shipping = 3190;
        const duties = i === 0 ? 4738 : 2264;
        return { sellerId: `seller_${i}`, checkoutSessionId: '', subtotalCents: subtotal, shippingCents: shipping, discountCents: 0, taxCents: 0, totalCents: subtotal + shipping + duties, processingDays: 3, dutiesCents: duties };
      });
      return { amountCents: groups.reduce((s, g) => s + g.totalCents, 0), groups, paymentMethodTypes: ['card'] };
    });
    await go(page, activity, origin, 'buyer', '/buyer-checkout', '&demo=1', 'checkout-price-breakdown');
    await scrollTo(page, 'checkout-price-breakdown');
    await page.waitForTimeout(600);
  } },
  // The signed-out seller preview blocks every API call (lib/api.ts
  // rejectSellerPreviewApiRequest), so seller screens are opened in the
  // buyer preview session, where the fake API answers.
  'shipping-zone-editor': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await json(context, origin, /\/shipping-zones\/settings/, { shipFromCountry: 'US', liveRatesAvailable: true, shipFromPostalCode: '10001', dutiesAtCheckout: true });
    await json(context, origin, /\/shipping-zones(\?|$)/, [DOMESTIC_ZONE, INTL_ZONE]);
    await go(page, activity, origin, 'buyer', '/shipping');
    const edits = page.getByText('Edit', { exact: true });
    await edits.nth(1).click().catch(async () => { await edits.first().click(); });
    await page.waitForTimeout(900);
    await page.getByText('Pricing', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
    await page.waitForTimeout(500);
  } },
  'shipping-zone-duties': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await json(context, origin, /\/shipping-zones\/settings/, { shipFromCountry: 'US', liveRatesAvailable: true, shipFromPostalCode: '10001', dutiesAtCheckout: true });
    await json(context, origin, /\/shipping-zones(\?|$)/, [DOMESTIC_ZONE, INTL_ZONE]);
    await go(page, activity, origin, 'buyer', '/shipping');
    const edits = page.getByText('Edit', { exact: true });
    await edits.nth(1).click().catch(async () => { await edits.first().click(); });
    await page.waitForTimeout(900);
    await page.getByText('Duties & customs', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await page.waitForTimeout(500);
  } },
  'taxes-duties': { role: 'buyer', run: async ({ context, page, activity, origin }) => {
    await json(context, origin, /\/taxes\/status/, {
      stripeTaxEnabled: false, provider: 'stripe_tax', providerConfigured: true, providerStatus: 'configured',
      automaticTaxAtCheckout: true, complianceNote: '', chargeShippingTax: false, chargeVat: false, collectDuties: false,
      dutiesAtCheckout: true, dutiesProvider: 'zonos',
    });
    await go(page, activity, origin, 'buyer', '/taxes-duties');
    await page.getByText('International duties', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await page.waitForTimeout(500);
  } },
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const name of ONLY.length ? ONLY : Object.keys(SHOTS)) {
      const shot = SHOTS[name];
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: shot.role, origin, images });
      try {
        await shot.run({ context, page, activity, origin });
        const file = path.join(OUT, `${TAG}-${name}.png`);
        await page.screenshot({ path: file });
        console.log(`wrote ${file}`);
      } catch (error) {
        console.warn(`skipped ${TAG}-${name}: ${String(error.message).split('\n')[0]}`);
        if (process.env.F7_DEBUG_DIR) await page.screenshot({ path: path.join(process.env.F7_DEBUG_DIR, `fail-${TAG}-${name}.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
