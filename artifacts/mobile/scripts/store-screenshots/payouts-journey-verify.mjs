#!/usr/bin/env node
/**
 * Payouts setup journey — hands-on check at 390x844 in the static web preview:
 *   01 dev preview (?bt_preview=seller, signed out): lands on state 1, the setup stage
 *   02 tapping "Set up payouts" in the preview says to sign in (no dead end)
 *   03-06 each later state, pinned with &demo=1&payoutState=… (fixtures in lib/payoutJourney.ts)
 *   07 Pop-up mode's "Set up payouts" gate lands on the same journey
 *   08 signed-in seller, fake API not_started: the button POSTs /seller/connect/onboard
 *      with return/refresh URLs on /payouts and leaves for Stripe's hosted page
 *   09 signed-in seller back from Stripe (?returned=1), status pending_verification
 * Fails if "unavailable" shows anywhere, or if a state lands on the wrong screen.
 *
 *   node scripts/store-screenshots/payouts-journey-verify.mjs [--skip-build]
 *   (cloud containers: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome)
 *
 * Output: docs/screenshots/payouts-journey/ (repo root)
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { BUYER_USER, respond } from './demo-data.mjs';
import { clerkStubScript } from './clerk-stub.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/screenshots/payouts-journey');
const device = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

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

const STATUS = {
  not_started: {
    connected: false, stripeAccountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
    status: 'not_started', verified: false, bankLast4: null, providerConfigured: true, payoutSchedule: null,
    requirementsDue: [], taxInfoStatus: 'unknown', setupState: 'not_started', payoutState: 'not_started', actionItems: [],
  },
  pending_verification: {
    connected: true, stripeAccountId: 'acct_demo', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true,
    status: 'restricted', verified: false, bankLast4: '6789', providerConfigured: true, payoutSchedule: null,
    requirementsDue: [], taxInfoStatus: 'submitted', setupState: 'in_review', payoutState: 'pending_verification', actionItems: [],
    steps: [
      { id: 'identity', label: 'Identity', status: 'in_review', detail: 'Stripe is reviewing this', pastDue: false },
      { id: 'bank_account', label: 'Bank account', status: 'complete', detail: 'Verified', pastDue: false },
      { id: 'tax_info', label: 'Tax info', status: 'complete', detail: 'W-9 on file. Stripe files your 1099', pastDue: false },
    ],
  },
};

/** A real signed-in seller (stubbed Clerk) whose connect calls hit these handlers. */
async function sellerRoutes(context, origin, statusBody, onboardBodies) {
  // The screenshot export treats a stored user_role=seller as the offline
  // seller preview; hide it so this seller reaches the (fake) API.
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem;
    // …and pin the saved preview role to guest: with none saved, this export
    // defaults to the offline seller preview (lib/devPreview.ts).
    Storage.prototype.getItem = function getItem(key) {
      if (key === 'user_role') return null;
      if (key === 'bt:previewRole:seller-review-v2') return 'guest';
      return get.call(this, key);
    };
  });
  const json = (route, body) => route.fulfill({ status: 200, headers: CORS(origin), contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(/\/api\/(v1\/)?seller\/connect\/status$/, (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS(origin) }) : json(route, statusBody));
  // An adult account, so the age gate in front of Payouts stays out of the way.
  await context.route(/\/api\/(v1\/)?auth\/me$/, (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS(origin) }) : json(route, { ...respond({ method: 'GET', path: '/auth/me', query: new URLSearchParams(), role: 'seller' }), ageBand: '18_plus' }));
  await context.route(/\/api\/(v1\/)?team\/context$/, (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS(origin) }) : json(route, { role: 'owner', storeOwnerId: 'seller', teamMembershipId: null }));
  await context.route(/\/api\/(v1\/)?seller\/connect\/onboard$/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS(origin) });
    onboardBodies.push(req.postDataJSON());
    return json(route, { url: 'https://connect.stripe.com/setup/e/acct_demo/abc123', stripeAccountId: 'acct_demo', kind: 'account_onboarding' });
  });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
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
  const noUnavailable = async (page, where) => {
    const body = await page.locator('body').innerText();
    expect(!/unavailable/i.test(body), `${where}: "unavailable" is on screen`);
  };

  async function previewPage(query) {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    await context.addInitScript(signedOutStub());
    let connectCalls = 0;
    await context.route(/\/api\/(v1\/)?seller\/connect\//, (route) => { connectCalls += 1; return route.fallback(); });
    await page.goto(`${origin}/payouts?bt_preview=seller${query}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 500, 8_000);
    return { context, page, connectCalls: () => connectCalls };
  }

  try {
    // ── 01/02 Dev preview, signed out: the setup stage ──────────────────────
    {
      const { context, page, connectCalls } = await previewPage('');
      await page.getByTestId('payouts-journey-not_started').waitFor({ timeout: 20_000 });
      const cta = page.getByTestId('payouts-journey-cta');
      expect(await cta.count() === 1, 'state 1: no "Set up payouts" button');
      for (const text of ['Set up payouts', "What you'll need", 'Bank account', 'Photo ID', 'SSN or EIN']) {
        expect(await page.getByText(text, { exact: false }).count() > 0, `state 1: "${text}" missing`);
      }
      expect(await page.getByTestId('seller-payouts-tab-payouts').count() === 0, 'state 1: manage page tabs rendered');
      await noUnavailable(page, 'state 1');
      await shot(page, '01-preview-state1-not-started');
      await cta.click();
      await page.getByText('Sign in to set up payouts').first().waitFor({ timeout: 5_000 }).catch(() => {});
      expect(await page.getByText('Sign in to set up payouts').count() > 0, 'preview tap: no sign-in guidance');
      await shot(page, '02-preview-state1-tap-sign-in');
      expect(connectCalls() === 0, `preview made ${connectCalls()} network connect call(s)`);
      await context.close();
    }

    // ── 03-06 Every later state, pinned ─────────────────────────────────────
    const pinned = [
      ['03-state2-onboarding-incomplete', 'onboarding_incomplete', 'Finish setting up payouts', 'payouts-journey-onboarding_incomplete'],
      ['04-state2-pending-verification', 'pending_verification', 'Stripe is verifying your info', 'payouts-journey-pending_verification'],
      ['05-state3-action-needed', 'action_needed', 'Stripe needs more info', 'payouts-journey-action_needed'],
      ['06-state4-active-manage-page', 'active', 'Payout balance', 'seller-payouts-tab-payouts'],
    ];
    for (const [name, state, title, testId] of pinned) {
      const { context, page } = await previewPage(`&demo=1&payoutState=${state}`);
      await page.getByTestId(testId).first().waitFor({ timeout: 20_000 });
      expect(await page.getByText(title, { exact: false }).count() > 0, `${state}: "${title}" missing`);
      if (state !== 'active') expect(await page.getByTestId('seller-payouts-tab-payouts').count() === 0, `${state}: manage page rendered`);
      await noUnavailable(page, state);
      await shot(page, name);
      if (state === 'active') {
        await page.getByTestId('seller-payouts-tab-settings').click();
        await page.waitForTimeout(300);
        await noUnavailable(page, 'active bank tab');
        await shot(page, '06b-state4-active-bank-tab');
      }
      await context.close();
    }

    // ── 07 Pop-up mode gate → the same journey ──────────────────────────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await context.addInitScript(signedOutStub());
      await page.goto(`${origin}/popup-mode?bt_preview=seller`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 500, 8_000);
      const gate = page.getByText('Set up payouts', { exact: true });
      await gate.first().waitFor({ timeout: 20_000 });
      await gate.first().click();
      await page.getByTestId('payouts-journey-not_started').waitFor({ timeout: 20_000 });
      expect(new URL(page.url()).pathname === '/payouts', `pop-up gate went to ${page.url()}`);
      await noUnavailable(page, 'pop-up entry');
      await shot(page, '07-popup-mode-gate-lands-on-setup');
      await context.close();
    }

    // ── 08 Signed-in seller: the real onboarding request ────────────────────
    {
      const bodies = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await sellerRoutes(context, origin, STATUS.not_started, bodies);
      let leftFor = null;
      await context.route('https://connect.stripe.com/**', (route) => { leftFor = route.request().url(); return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#fff;font:16px sans-serif;padding:24px">Stripe Connect onboarding (stubbed)</body></html>' }); });
      await page.goto(`${origin}/payouts`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await page.getByTestId('payouts-journey-not_started').waitFor({ timeout: 20_000 });
      await waitForQuietNetwork(activity, 500, 8_000);
      await noUnavailable(page, 'signed-in state 1');
      await shot(page, '08a-signed-in-state1');
      await page.getByTestId('payouts-journey-cta').click();
      await page.waitForURL(/connect\.stripe\.com/, { timeout: 10_000 }).catch(() => {});
      expect(bodies.length >= 1, 'no POST /seller/connect/onboard');
      expect(bodies[0]?.returnUrl === `${origin}/payouts?returned=1`, `returnUrl was ${bodies[0]?.returnUrl}`);
      expect(bodies[0]?.refreshUrl === `${origin}/payouts?refresh=1`, `refreshUrl was ${bodies[0]?.refreshUrl}`);
      expect(leftFor === 'https://connect.stripe.com/setup/e/acct_demo/abc123', `did not leave for Stripe (${leftFor})`);
      await shot(page, '08b-left-for-stripe-hosted-onboarding');
      await context.close();
    }

    // ── 09 Back from Stripe: status re-read on /payouts?returned=1 ──────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await sellerRoutes(context, origin, STATUS.pending_verification, []);
      await page.goto(`${origin}/payouts?returned=1`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await page.getByTestId('payouts-journey-pending_verification').waitFor({ timeout: 20_000 });
      await waitForQuietNetwork(activity, 500, 8_000);
      await noUnavailable(page, 'returned');
      await shot(page, '09-returned-from-stripe-verifying');
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll payouts journey checks passed.');
}

main().catch((error) => { console.error(error); process.exit(1); });
