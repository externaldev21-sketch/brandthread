#!/usr/bin/env node
/**
 * Seller payout gate — captures at 390x844 against the fake demo API:
 *   01 listing flow: inline "Set up payouts" card (payouts not ready)
 *   02 Save with status Active → saved as a draft (POST body status=draft)
 *   03 the card's button opens the existing Stripe Connect setup flow
 *   04 dashboard: "Finish payout setup" banner (live listings, payouts incomplete)
 *   05 payouts ready: no card, Save publishes (POST body status=active)
 *   06 signed-out ?bt_preview=seller: gate bypassed, no card, no gate request
 *
 *   node scripts/store-screenshots/payout-gate-verify.mjs [--skip-build]
 *
 * Output: docs/screenshots/payout-gate/ (repo root)
 */
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BUYER_USER } from './demo-data.mjs';
import { clerkStubScript } from './clerk-stub.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/screenshots/payout-gate');
const device = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
// A tiny valid JPEG used as the picked product photo.
const FAKE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLFRgTEQ4dHR8bGBQVFR4pIRwjKykpJi01Pi01LVBLTU9WV1lZWVlZWVn/2wBDAQkJCQwLDBYPDxYaFRUVGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AKAP/9k=',
  'base64',
);

function signedOutStub() {
  return clerkStubScript(BUYER_USER)
    .replace('sessions: [session], activeSessions: [session], lastActiveSessionId: session.id', 'sessions: [], activeSessions: [], lastActiveSessionId: null')
    .replace('listener({ client, session, user: clerkUser, organization: null })', 'listener({ client, session: null, user: null, organization: null })')
    .replace('    session,\n    user: clerkUser,\n    client,', '    session: null,\n    user: null,\n    client,')
    .replace('__internal_lastEmittedResources: { client, session, user: clerkUser, organization: null }', '__internal_lastEmittedResources: { client, session: null, user: null, organization: null }');
}

const CORS = (origin) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'authorization,content-type,x-store-context',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
});

/** Overrides the payout-gate read and product create/upload on top of the harness fake API. */
async function gateRoutes(context, origin, gate, posted) {
  // The screenshot export treats a stored user_role=seller as the offline
  // seller preview (lib/devPreview.ts persistedPreviewRole), which refuses
  // every write client-side. Hide it so the stubbed signed-in seller is a
  // real seller whose Save reaches the (fake) API and the payout gate.
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) { return key === 'user_role' ? null : get.call(this, key); };
  });
  const json = (route, body) => route.fulfill({ status: 200, headers: CORS(origin), contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(/\/api\/(v1\/)?products\/payout-gate$/, (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS(origin) }) : json(route, gate));
  await context.route(/\/api\/(v1\/)?products\/images$/, (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS(origin) }) : json(route, { objectPath: '/objects/mock-photo.jpg' }));
  await context.route(/\/api\/(v1\/)?products$/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS(origin) });
    if (req.method() !== 'POST') return route.fallback();
    const body = req.postDataJSON();
    posted.push(body.status);
    return route.fulfill({ status: 201, headers: CORS(origin), contentType: 'application/json', body: JSON.stringify({ id: 'demo-new-product', ...body }) });
  });
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

// Signed-in sellers (stubbed Clerk + fake API) reach the real payout gate; a
// ?bt_preview=seller session never calls the API (lib/api.ts), so it is only
// used for the bypass shot.
async function openAddProduct(page, activity, origin, query = '') {
  await page.goto(`${origin}/add-product${query}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.getByText('Photos').first().waitFor({ timeout: 20_000 });
  await waitForQuietNetwork(activity, 500, 8_000);
  // The top status-bar mask overlaps the header controls at this viewport;
  // let clicks through (test page only).
  await page.addStyleTag({ content: '[data-testid="status-bar-mask"]{pointer-events:none!important}' });
  // Dismiss the add-product first-run tips so they don't cover the form.
  const skip = page.getByText('Skip', { exact: true });
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(300); }
}

async function fillListing(page) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('add-product-add-photos').first().click();
  const chooser = await chooserPromise;
  const tmp = path.join(MOBILE_ROOT, '.store-screenshots', 'payout-gate-photo.jpg');
  writeFileSync(tmp, FAKE_JPEG);
  await chooser.setFiles([tmp]);
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.getByTestId('media-cropper-save').click();
  await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });
  await page.getByPlaceholder('e.g. Vintage Washed Tee').fill('Washed Logo Tee');
  await page.getByPlaceholder('0.00').first().fill('45');
  await page.getByTestId('add-product-status-pill').click();
  await page.getByText('Active — visible and purchasable').click();
  await page.waitForTimeout(400);
}

async function main() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    console.log('Building preview web export…');
    buildPreviewWeb();
  }
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const failures = [];
  const expect = (ok, msg) => { if (!ok) { failures.push(msg); console.error(`  ✗ ${msg}`); } };
  try {
    // ── Payouts not set up: listing flow ────────────────────────────────────
    {
      const posted = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await gateRoutes(context, origin, { ready: false, payoutStatus: 'not_started', liveProductCount: 0 }, posted);
      await openAddProduct(page, activity, origin);
      await page.getByTestId('add-product-payout-setup-card').waitFor({ timeout: 10_000 });
      await shot(page, '01-listing-set-up-payouts-card');

      await fillListing(page);
      await page.getByTestId('add-product-save').click();
      await page.getByText('Draft saved', { exact: true }).waitFor({ timeout: 10_000 });
      expect(posted.length === 1 && posted[0] === 'draft', `expected one POST with status=draft, got ${JSON.stringify(posted)}`);
      await shot(page, '02-listing-saved-as-draft');
      await context.close();
    }
    // ── The card deep-links into the existing Stripe Connect setup flow ─────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await gateRoutes(context, origin, { ready: false, payoutStatus: 'not_started', liveProductCount: 0 }, []);
      await openAddProduct(page, activity, origin);
      await page.getByTestId('add-product-set-up-payouts').click();
      await page.waitForURL(/\/payout-setup/, { timeout: 10_000 });
      await waitForQuietNetwork(activity, 500, 8_000);
      await shot(page, '03-card-opens-payout-setup');
      await context.close();
    }
    // ── Dashboard: live listings from before the gate ───────────────────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await gateRoutes(context, origin, { ready: false, payoutStatus: 'restricted', liveProductCount: 3 }, []);
      await page.goto(`${origin}/`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      const banner = page.getByTestId('seller-dashboard-finish-payouts-banner');
      await banner.waitFor({ timeout: 20_000 });
      await waitForQuietNetwork(activity, 500, 8_000);
      // Dismiss the dashboard first-run tour so it doesn't cover the banner.
      for (let i = 0; i < 3; i++) {
        const skip = page.getByText('Skip', { exact: true });
        if (!(await skip.count())) break;
        await skip.first().click();
        await page.waitForTimeout(400);
      }
      await banner.scrollIntoViewIfNeeded();
      await shot(page, '04-dashboard-finish-payout-setup-banner');
      await context.close();
    }
    // ── Payouts ready: no card, publishes as active ─────────────────────────
    {
      const posted = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await gateRoutes(context, origin, { ready: true, payoutStatus: 'active', liveProductCount: 3 }, posted);
      await openAddProduct(page, activity, origin);
      await page.waitForTimeout(800);
      expect(await page.getByTestId('add-product-payout-setup-card').count() === 0, 'card shown although payouts are ready');
      await fillListing(page);
      await page.getByTestId('add-product-save').click();
      await page.getByText('Product published!').waitFor({ timeout: 10_000 });
      expect(posted.length === 1 && posted[0] === 'active', `expected one POST with status=active, got ${JSON.stringify(posted)}`);
      await shot(page, '05-payouts-ready-publishes');
      await context.close();
    }
    // ── Signed-out preview seller: gate bypassed ────────────────────────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await context.addInitScript(signedOutStub());
      let gateCalls = 0;
      await context.route(/\/api\/(v1\/)?products\/payout-gate$/, (route) => { gateCalls += 1; return route.fallback(); });
      await openAddProduct(page, activity, origin, '?bt_preview=seller');
      await page.waitForTimeout(800);
      expect(await page.getByTestId('add-product-payout-setup-card').count() === 0, 'card shown for a preview seller');
      expect(gateCalls === 0, `preview seller called the payout gate ${gateCalls} time(s)`);
      await shot(page, '06-preview-seller-bypass');
      await context.close();
    }
  } catch (err) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: path.join(MOBILE_ROOT, '.store-screenshots', 'payout-gate-failure.png') }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
  console.log('All payout gate checks passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });
