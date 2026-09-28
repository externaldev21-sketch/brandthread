#!/usr/bin/env node
/**
 * Item 106 — end-to-end check of checkout address autocomplete at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer,
 * fake API) into /buyer-checkout, opens the Shipping address sheet and
 * actually types into "Start typing your address". The server's
 * /api/buyer/address-suggestions(/:placeId) routes are answered with the
 * exact shapes artifacts/api-server/src/routes/buyer.ts returns for each
 * Google Places outcome (results, no results, 502 upstream failure, 503 not
 * configured, 422 incomplete place), so every client state is exercised.
 *
 *   node scripts/address-autocomplete-screenshots.mjs [--skip-build] [--tag=before|after] [--only=a,b]
 *
 * Output: docs/pr-review/address-autocomplete-106/<tag>-<shot>.jpg
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/address-autocomplete-106');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'after';

const SAVED_ADDRESSES = [
  { id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true },
  { id: 'addr_studio', label: 'Studio', recipientName: 'Jordan Reyes', street: '2231 SE Division Street', city: 'Portland', state: 'OR', postalCode: '97202', country: 'US', phone: '+1 (503) 555-0142', isDefault: false },
];

// Google Places results as the server maps them ({ placeId, label }, max 5).
const SUGGESTIONS = [
  { placeId: 'pl_bk', label: '350 Bedford Ave, Brooklyn, NY 11211, USA' },
  { placeId: 'pl_bk2', label: '350 Bedford Ave #3, Brooklyn, NY 11211, USA' },
  { placeId: 'pl_sf', label: '350 Bedford St, San Francisco, CA 94110, USA' },
];
const RESOLVED = {
  pl_bk: { line1: '350 Bedford Ave', city: 'Brooklyn', state: 'NY', postalCode: '11211', country: 'US' },
  pl_bk2: { line1: '350 Bedford Ave', city: 'Brooklyn', state: 'NY', postalCode: '11211', country: 'US' },
  pl_sf: { line1: '350 Bedford St', city: 'San Francisco', state: 'CA', postalCode: '94110', country: 'US' },
};

function session({ filled }) {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  const subtotalCents = group.items[0].priceCents;
  const s = {
    ...base, deliveryGroups: [group], isBuyNow: true, acknowledgments: [],
    summary: { ...base.summary, subtotalCents, shippingTotalCents: 1200, totalCents: subtotalCents + 1200 },
  };
  if (filled) s.shippingAddress = { ...s.shippingAddress, id: 'addr_home' };
  else { delete s.shippingAddress; }
  return s;
}

let ORIGIN = '';
function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

/** mode: 'ok' | 'empty' | 'down' (502) | 'unconfigured' (503) | 'incomplete' (422 on resolve) */
async function open(browser, images, origin, { filled, addresses, mode = 'ok' }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  const calls = [];
  const state = { mode };
  if (process.env.DBG) page.on('response', (r) => { if (r.url().includes('address-suggestions')) console.log('   resp', r.status(), r.request().method(), r.url().slice(-40)); });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/addresses' && request.method() === 'GET') return json(route, addresses);
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: [] });
    if (p === '/api/buyer/address-suggestions') {
      calls.push(`q=${url.searchParams.get('q')}`);
      if (state.mode === 'down') return json(route, { error: 'Address suggestions are temporarily unavailable' }, 502);
      if (state.mode === 'unconfigured') return json(route, { error: 'Address suggestions are not configured' }, 503);
      if (state.mode === 'empty') return json(route, []);
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return json(route, SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(q.slice(0, 6))));
    }
    if (p.startsWith('/api/buyer/address-suggestions/')) {
      const id = decodeURIComponent(p.split('/').pop());
      calls.push(`resolve ${id}`);
      if (state.mode === 'incomplete') return json(route, { error: 'Select a complete deliverable street address' }, 422);
      return json(route, RESOLVED[id]);
    }
    if (p === '/api/buyer/cart/validate') return json(route, { isValid: true, issues: [] });
    return route.fallback();
  });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-checkout?source=buynow', {
      beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(session({ filled }))]),
    });
    try { await page.getByText('Order total').first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(500);
  return { context, page, calls, state };
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${TAG}-${name}`);
}

const SEARCH = 'Shipping address search';
async function fields(page) {
  const v = async (label) => page.getByLabel(label, { exact: true }).last().inputValue();
  return { line1: await page.getByLabel(SEARCH).inputValue(), city: await v('City'), state: await v('State'), zip: await v('ZIP code'), country: await v('Country') };
}
async function visibleSuggestions(page) {
  return page.getByRole('button', { name: /^Use address / }).count();
}
async function typeSlowly(page, text) {
  const input = page.getByLabel(SEARCH);
  await input.click();
  await input.pressSequentially(text, { delay: 60 });
}
async function openSheet(page, via) {
  if (via === 'add-first') await page.getByTestId('checkout-add-address').click();
  else if (via === 'add-new') await page.getByLabel('Add a new address').click();
  else if (via === 'edit') await page.getByLabel('Edit shipping address').first().click();
  await page.getByText('Use this address').waitFor();
  await page.waitForTimeout(500);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  ORIGIN = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const want = (k) => !only || only.includes(k);
  const results = {};
  try {
    // A. First-time buyer: no saved addresses.
    if (want('first')) {
      const { context, page, calls } = await open(browser, images, ORIGIN, { filled: false, addresses: [] });
      await shot(page, '01-first-time-empty-card');
      await openSheet(page, 'add-first');
      await page.getByLabel('First name').fill('Jordan');
      await page.getByLabel('Last name').fill('Reyes');
      await typeSlowly(page, '350 Bedf');
      await page.getByRole('button', { name: /^Use address 350 Bedford Ave, Brooklyn/ }).waitFor({ timeout: 10_000 });
      await shot(page, '02-suggestions-while-typing');
      await page.getByRole('button', { name: /^Use address 350 Bedford Ave, Brooklyn/ }).click();
      await page.waitForTimeout(1500); // > debounce: does the list come back after choosing?
      const filledFields = await fields(page);
      const listAfterPick = await visibleSuggestions(page);
      await shot(page, '03-after-select-fields-filled');
      await page.getByTestId('checkout-use-address').click();
      await page.waitForTimeout(700);
      await page.getByTestId('checkout-shipping').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(page, '04-first-time-address-on-card');
      // Re-open via Edit: the saved street must not pop a dropdown by itself.
      await openSheet(page, 'edit');
      await page.waitForTimeout(1200);
      const listOnEditOpen = await visibleSuggestions(page);
      await shot(page, '05-edit-reopen');
      results.first = { filledFields, listAfterPick, listOnEditOpen, calls };
      await context.close();
    }

    // B. Alongside saved addresses: saved → add new → back to saved → new again.
    if (want('saved')) {
      const { context, page, calls } = await open(browser, images, ORIGIN, { filled: true, addresses: SAVED_ADDRESSES });
      await page.getByTestId('checkout-shipping').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(page, '06-saved-addresses');
      await openSheet(page, 'add-new');
      await typeSlowly(page, '350 Bedford St');
      await page.getByRole('button', { name: /^Use address 350 Bedford St, San Francisco/ }).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: /^Use address 350 Bedford St, San Francisco/ }).click();
      await page.waitForTimeout(1500);
      const filledFields = await fields(page);
      await page.getByTestId('checkout-use-address').click();
      await page.waitForTimeout(700);
      await page.getByTestId('checkout-shipping').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(page, '07-saved-plus-new-selected');
      const radios = async () => page.getByTestId('checkout-shipping').evaluate((el) => [...el.querySelectorAll('[role="radio"]')].map((r) => `${r.getAttribute('aria-checked') ?? r.getAttribute('aria-selected')}:${(r.getAttribute('aria-label') ?? r.textContent).slice(0, 28)}`));
      const afterNew = await radios();
      await page.getByRole('radio', { name: /^Studio/ }).click();
      await page.waitForTimeout(500);
      const afterStudio = await radios();
      await shot(page, '08-switched-back-to-saved');
      await openSheet(page, 'add-new');
      const blankOnAddNew = await fields(page);
      await page.getByLabel('Close address form').click();
      await page.waitForTimeout(500);
      results.saved = { filledFields, afterNew, afterStudio, blankOnAddNew, calls };
      await context.close();
    }

    // C. Failure states.
    for (const mode of ['empty', 'down', 'unconfigured', 'incomplete']) {
      if (!want(mode)) continue;
      const { context, page, calls, state } = await open(browser, images, ORIGIN, { filled: false, addresses: [], mode });
      await openSheet(page, 'add-first');
      await typeSlowly(page, mode === 'empty' ? '99999 Nowhere Rd' : '350 Bedf');
      if (mode === 'incomplete') {
        await page.getByRole('button', { name: /^Use address 350 Bedford Ave, Brooklyn/ }).waitFor({ timeout: 10_000 });
        let dialog = null;
        page.once('dialog', (d) => { dialog = d.message(); void d.dismiss(); });
        await page.getByRole('button', { name: /^Use address 350 Bedford Ave, Brooklyn/ }).click();
        await page.waitForTimeout(1200);
        results[mode] = { dialog, calls };
      } else {
        await page.waitForTimeout(2000);
        results[mode] = { calls, suggestions: await visibleSuggestions(page) };
      }
      const text = await page.evaluate(() => document.body.innerText);
      results[mode].status = (text.match(/(No matching|Suggestions aren|Address search is|That place|We couldn)[^\n]*/g) ?? []).slice(0, 4);
      await shot(page, `09-${mode}`);
      if (mode === 'down' && TAG !== 'before') {
        // Places recovers → "Try again" brings the list back.
        state.mode = 'ok';
        await page.getByLabel('Try loading address suggestions again').click();
        await page.getByRole('button', { name: /^Use address 350 Bedford Ave, Brooklyn/ }).waitFor({ timeout: 10_000 });
        results[mode].afterRetry = await visibleSuggestions(page);
        await shot(page, '10-down-then-try-again');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
