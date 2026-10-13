#!/usr/bin/env node
/**
 * Seller money tools 7 (Stripe Tax regions + 1.5% instant payouts) on the
 * store-screenshots harness (signed-in demo seller, fake API).
 *
 *   node scripts/f4-money-screenshots.mjs <buildDir> <outDir> <before|after> [width] [height]
 *
 * after:  Taxes and duties, Tax regions, Add region (search + selected),
 *         region added toast, Head office, Payout schedule (instant quote).
 * before: Taxes and duties and Payout schedule only (what exists on dev).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const VIEWPORT = { width: Number(process.argv[5] ?? 393), height: Number(process.argv[6] ?? 852) };
const TAG = `${MODE}-${VIEWPORT.width}x${VIEWPORT.height}`;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const REGIONS = [
  ['AL', 'Alabama'], ['AZ', 'Arizona'], ['CA', 'California'], ['CO', 'Colorado'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['IL', 'Illinois'], ['MA', 'Massachusetts'], ['NJ', 'New Jersey'], ['NY', 'New York'], ['OR', 'Oregon'],
  ['TX', 'Texas'], ['WA', 'Washington'],
].map(([state, name]) => ({ code: `US-${state}`, country: 'US', state, name }))
  .concat([['AU', 'Australia'], ['CA', 'Canada'], ['NZ', 'New Zealand'], ['GB', 'United Kingdom']]
    .map(([country, name]) => ({ code: country, country, state: null, name })));

const registrations = [
  { id: 'taxreg_ca', code: 'US-CA', country: 'US', state: 'CA', name: 'California', status: 'active', activeFrom: '2026-01-01T00:00:00.000Z', expiresAt: null },
  { id: 'taxreg_ny', code: 'US-NY', country: 'US', state: 'NY', name: 'New York', status: 'active', activeFrom: '2026-03-01T00:00:00.000Z', expiresAt: null },
  { id: 'taxreg_tx', code: 'US-TX', country: 'US', state: 'TX', name: 'Texas', status: 'scheduled', activeFrom: '2026-11-01T00:00:00.000Z', expiresAt: null },
  { id: 'taxreg_gb', code: 'GB', country: 'GB', state: null, name: 'United Kingdom', status: 'active', activeFrom: '2026-02-01T00:00:00.000Z', expiresAt: null },
];
const headOffice = { line1: '1 Market St', line2: null, city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US' };

const FEE_BPS = MODE === 'before' ? 100 : 150;
const MAX = MODE === 'before' ? 182_409 : 181_527;
const FEE = MODE === 'before' ? 1_824 : 2_723;
const fmt = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAYOUT_SCHEDULE = {
  connected: true, providerConfigured: true, payoutsEnabled: true,
  schedule: { interval: 'manual', weeklyAnchor: null, delayDays: 2 },
  instant: {
    eligible: true, reason: null,
    destination: { id: 'card_demo', brand: 'Visa', last4: '4242', funding: 'debit' },
    feeBps: FEE_BPS, minFeeCents: 50,
    maxAmount: { amount: MAX, formatted: fmt(MAX) },
    quote: { amount: MAX, fee: FEE, feeFormatted: fmt(FEE), total: MAX + FEE, withinBalance: true, stripeFee: 1_815, platformFee: FEE - 1_815 },
  },
  nextPayoutEstimate: { kind: 'manual', date: null, amount: 184_250, formatted: '$1,842.50' },
  policy: { mode: 'hold', enforced: false, instantFeeBps: FEE_BPS, instantMinFeeCents: 50 },
};

let ORIGIN = '*';
function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), caret: 'hide' });
  console.log(`  ok ${TAG}-${name}`);
}

/** Text that does not fit its box, or sits off screen. */
async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const offScreen = r.right > vw + 1 || r.left < -1;
      if (ellipsis || offScreen) out.push({ text: text.slice(0, 40), ellipsis, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}

/**
 * The harness signs the demo seller in, but in the seller web preview the
 * API client refuses every request (lib/api.ts rejectSellerPreviewApiRequest),
 * so these screens are shown the way the preview really shows them: signed
 * out, with `&demo=1` data (isPreviewDemoMode). This runs after the Clerk
 * stub and empties its session.
 */
const SIGNED_OUT = () => {
  const c = window.Clerk;
  if (!c) return;
  const client = { id: 'client_demo', sessions: [], activeSessions: [], lastActiveSessionId: null, signIn: {}, signUp: {} };
  c.session = null;
  c.user = null;
  c.client = client;
  c.__internal_lastEmittedResources = { client, session: null, user: null, organization: null };
  c.addListener = (listener) => { listener({ client, session: null, user: null, organization: null }); return () => undefined; };
};

/** Client-side navigation that keeps `&demo=1` (router.push drops the query). */
async function go(page, route) {
  await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, `${route}?bt_preview=seller&demo=1`);
}

async function waitFor(page, route, ready) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await ready().waitFor({ timeout: 12_000 });
      return;
    } catch (error) {
      if (attempt === 5) { await page.screenshot({ path: path.join(OUT, `debug-${route.replace(/\//g, '')}.png`) }); throw error; }
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, `${route}?bt_preview=seller&demo=1`);
    }
  }
}

async function run() {
  const server = await serveBuild(BUILD);
  ORIGIN = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images });
    await context.addInitScript(SIGNED_OUT);
    let added = false;
    if (process.env.DEBUG_API) {
      page.on('request', (r) => { if (!r.url().includes('/_expo/') && !r.url().includes('/assets/')) console.log('  req', r.method(), r.url().slice(0, 120)); });
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  console', m.type(), m.text().slice(0, 200)); });
      page.on('pageerror', (e) => console.log('  pageerror', String(e).slice(0, 200)));
      page.on('requestfailed', (r) => { if (r.url().includes('api.brandthread.test')) console.log('  failed', r.url(), r.failure()?.errorText); });
    }
    await context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      if (p === '/api/taxes/status') return json(route, { stripeTaxEnabled: true, provider: 'stripe_tax', providerConfigured: true, providerStatus: 'configured', automaticTaxAtCheckout: true, chargeShippingTax: false, chargeVat: false });
      if (p === '/api/taxes/1099') return json(route, { year: 2026, grossPaymentCents: 1_284_500, transactionCount: 87, threshold: { meetsFederalThreshold: false, summary: '$20,000 and 200 transactions' }, forms: [] });
      if (p === '/api/taxes/registrations' && request.method() === 'POST') {
        added = true;
        return json(route, { registration: { id: 'taxreg_fl', code: 'US-FL', country: 'US', state: 'FL', name: 'Florida', status: 'active', activeFrom: null, expiresAt: null } }, 201);
      }
      if (p === '/api/taxes/registrations') {
        const list = added
          ? [...registrations, { id: 'taxreg_fl', code: 'US-FL', country: 'US', state: 'FL', name: 'Florida', status: 'active', activeFrom: null, expiresAt: null }].sort((a, b) => a.name.localeCompare(b.name))
          : registrations;
        return json(route, { connected: true, providerConfigured: true, headOffice, registrations: list, regions: REGIONS });
      }
      if (p === '/api/finance/payout-schedule') return json(route, PAYOUT_SCHEDULE);
      return route.fallback();
    });

    await openScreen(page, activity, server.origin, 'seller', '/taxes-duties', { extraQuery: '&demo=1' });
    await waitFor(page, '/taxes-duties', () => page.getByText('Collect sales tax', { exact: true }));
    await waitForQuietNetwork(activity, 900, 15_000);
    await page.waitForTimeout(800);
    await shot(page, '01-taxes-duties-top');
    if (MODE === 'after') await page.getByTestId('taxes-duties-regions').scrollIntoViewIfNeeded();
    else await page.getByText('Not available directly in-app yet', { exact: true }).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(600);
    await shot(page, '02-taxes-duties-regions-row');
    await overflowCheck(page, 'taxes-duties');

    if (MODE === 'after') {
      await openScreen(page, activity, server.origin, 'seller', '/tax-regions', { extraQuery: '&demo=1' });
      await waitFor(page, '/tax-regions', () => page.getByTestId('tax-regions-head-office'));
      await waitForQuietNetwork(activity, 900, 15_000);
      await page.waitForTimeout(800);
      await shot(page, '03-tax-regions');
      await overflowCheck(page, 'tax-regions');

      await openScreen(page, activity, server.origin, 'seller', '/tax-region-add', { extraQuery: '&demo=1' });
      await waitFor(page, '/tax-region-add', () => page.getByTestId('tax-region-option-US-FL'));
      await page.waitForTimeout(800);
      await shot(page, '04-add-region');
      await page.getByPlaceholder('Search states and countries').fill('flo');
      await page.waitForTimeout(400);
      await page.getByTestId('tax-region-option-US-FL').click();
      await page.waitForTimeout(400);
      await shot(page, '05-add-region-selected');
      await overflowCheck(page, 'add-region');
      await openScreen(page, activity, server.origin, 'seller', '/tax-head-office', { extraQuery: '&demo=1' });
      await waitFor(page, '/tax-head-office', () => page.getByText('Street address', { exact: true }));
      await waitForQuietNetwork(activity, 900, 15_000);
      await page.waitForTimeout(800);
      await shot(page, '07-head-office');
      await overflowCheck(page, 'head-office');
    }

    await openScreen(page, activity, server.origin, 'seller', '/payout-schedule', { extraQuery: '&demo=1' });
    await waitFor(page, '/payout-schedule', () => page.getByText('When you get paid', { exact: true }));
    await waitForQuietNetwork(activity, 900, 15_000);
    await page.waitForTimeout(800);
    await shot(page, '08-payout-schedule-instant');
    await overflowCheck(page, 'payout-schedule');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
