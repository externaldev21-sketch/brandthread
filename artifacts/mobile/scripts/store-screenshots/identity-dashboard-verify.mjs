#!/usr/bin/env node
/**
 * Identity everywhere, dashboard cards that retire, one-tap seller messages —
 * hands-on at 390x844 in the static web preview, as a SIGNED-IN seller/buyer
 * whose API answers are stubbed (so every surface runs its real code path):
 *
 *   01-04 identity: the server says "Night Shift Studio" / @nightshiftstudio
 *         with a profile photo. Clerk says "Maya Okafor" / @northlinestudio, so
 *         any surface still reading Clerk shows up as a mismatch. Checked on
 *         the dashboard header (name, @handle link, photo), Profile, More
 *         and Settings.
 *   05-06 propagation: no photo → monogram; the seller then sets a photo and
 *         renames the store; back on the dashboard both show without a reload.
 *   07-10 incentives, each flipped through server state only:
 *         new seller (all cards) → plan bought (plan block gone) → first
 *         product live ("List your first product" gone) → all 9 steps done
 *         (checklist gone, layout closes up).
 *   11-13 messages: dashboard icon badge = unread threads (2), tap → inbox;
 *         Profile "Messages" button with a 2 badge → inbox.
 *   14    buyer: name + @username from onboarding on the buyer profile.
 *
 *   node scripts/store-screenshots/identity-dashboard-verify.mjs [--skip-build]
 *   (cloud containers: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome)
 *
 * Output: docs/screenshots/identity-dashboard/ (repo root)
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { IMAGE_HOST, SELLER_USER, respond } from './demo-data.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/screenshots/identity-dashboard');
const device = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const PHOTO = `${IMAGE_HOST}/demo/portrait-mono.jpg`;
const STEP_IDS = ['name_handle', 'logo_banner', 'accent', 'socials', 'first_product', 'shipping', 'preview', 'publish', 'payouts'];
const READY_IDS = ['first_product', 'name_store', 'shipping_rates', 'payouts', 'customize_store', 'share_store'];

function checklist(done) {
  const steps = STEP_IDS.map((id) => ({ id, done: done.includes(id) }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length, handle: 'nightshiftstudio', dismissed: false };
}
function readyToSell(done) {
  const map = { first_product: 'first_product', name_store: 'name_handle', shipping_rates: 'shipping', payouts: 'payouts', customize_store: 'accent', share_store: 'publish' };
  const steps = READY_IDS.map((id) => ({ id, done: done.includes(map[id]) }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length, hasSale: false };
}
/** The harness's realistic seller threads (same shape as GET /conversations), with chosen unread counts. */
const threads = (unreadCounts) => respond({ method: 'GET', path: '/conversations', query: new URLSearchParams(), role: 'seller', options: { conversationCount: unreadCounts.length } })
  .map((thread, i) => ({ ...thread, unreadCount: unreadCounts[i] }));

/** Mutable server state the stubs read on every request — flip it to flip the UI. */
function defaultState() {
  return {
    identity: { brandName: 'Night Shift Studio', displayName: 'Maya Okafor', name: 'Maya Okafor', username: 'nightshiftstudio', photo: PHOTO },
    done: [],
    plan: null,
    conversations: threads([3, 1, 0]),
  };
}

async function sellerApi(context, origin, state) {
  // Hide the stored seller preview role so this signed-in seller reaches the
  // stubbed API instead of the offline preview (same as payouts-journey-verify),
  // and keep the account's own scoped role (RoleContext) as seller so /profile
  // is the seller profile.
  await context.addInitScript((userId) => {
    localStorage.setItem(`user_role:${userId}`, 'seller');
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) {
      if (key === 'user_role') return null;
      if (key === 'bt:previewRole:seller-review-v2') return 'guest';
      return get.call(this, key);
    };
  }, SELLER_USER.id);
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const stub = (re, body) => context.route(re, (route) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body()) })));
  const base = (p) => respond({ method: 'GET', path: p, query: new URLSearchParams(), role: 'seller', options: { fresh: true } });
  await stub(/\/api\/(v1\/)?auth\/(me|sync)$/, () => {
    const { brandName, displayName, name, username } = state.identity;
    return { ...base('/auth/me'), brandName, displayName, name, username, accountType: 'seller', onboardingComplete: true, ageBand: '18_plus' };
  });
  await stub(/\/api\/(v1\/)?seller\/profile$/, () => {
    const { brandName, displayName, username, photo } = state.identity;
    return { ...base('/seller/profile'), brandName, displayName, username, profileImageUrl: photo, avatarPosterUrl: null, avatarVideoUrl: null, logoUrl: null };
  });
  await stub(/\/api\/(v1\/)?seller\/launch-checklist$/, () => checklist(state.done));
  await stub(/\/api\/(v1\/)?seller\/launch-checklist\/ready-to-sell$/, () => readyToSell(state.done));
  await stub(/\/api\/(v1\/)?seller\/subscription\/status$/, () => (state.plan
    ? { ...base('/seller/subscription/status'), plan: state.plan, status: 'trialing' }
    : { plan: null, status: 'none' }));
  await stub(/\/api\/(v1\/)?conversations$/, () => state.conversations);
  await stub(/\/api\/(v1\/)?team\/context$/, () => ({ role: 'owner', storeOwnerId: 'seller', teamMembershipId: null }));
}

async function main() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    console.log('Building preview web export…');
    buildPreviewWeb();
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const failures = [];
  const expect = (ok, msg) => { if (!ok) { failures.push(msg); console.error(`  ✗ ${msg}`); } else console.log(`    ok  ${msg}`); };

  async function shot(page, name) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}`);
  }
  async function dismissChrome(page) {
    // The setup walkthrough auto-opens once on a fresh seller's dashboard.
    try { await page.getByText('Continue setup later', { exact: true }).click({ timeout: 4000 }); await page.waitForTimeout(500); } catch {}
    try { await page.getByText('Necessary only', { exact: true }).click({ timeout: 1500 }); } catch {}
    for (const t of ['Continue setup later', 'Close', 'Not now', 'Skip for now', 'Skip', 'Got it', 'Maybe later']) {
      try { await page.getByRole('button', { name: t, exact: true }).first().click({ timeout: 500 }); } catch {}
    }
  }
  async function seller(state) {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images, apiOptions: { fresh: true } });
    await sellerApi(context, origin, state);
    return { context, page, activity };
  }
  async function open(page, activity, route, readyTestId) {
    await page.goto(`${origin}${route}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    if (readyTestId) await page.getByTestId(readyTestId).first().waitFor({ timeout: 25_000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(OUT, `debug-${route.replace(/\W/g, '_')}.png`) });
      throw e;
    });
    await waitForQuietNetwork(activity, 600, 10_000);
    await dismissChrome(page);
  }
  // /profile is the buyer route; the seller profile tab is /(tabs)/profile.
  async function openSellerProfile(page, activity, readyTestId) {
    await open(page, activity, '/(tabs)/profile', readyTestId);
  }
  const text = (page, testId) => page.getByTestId(testId).first().innerText().catch(() => '');
  const count = (page, testId) => page.getByTestId(testId).count();
  const bodyHas = async (page, s) => (await page.locator('body').innerText()).includes(s);
  const headerPhoto = (page) => page.locator('[data-testid="seller-dashboard-scroll-position"] img').count();

  try {
    // ── 01-04 Identity everywhere ─────────────────────────────────────────
    {
      const state = defaultState();
      const { context, page, activity } = await seller(state);
      await open(page, activity, '/', 'seller-dashboard-store-name');
      await page.waitForFunction(() => document.querySelector('[data-testid="seller-dashboard-store-name"]')?.textContent === 'Night Shift Studio', undefined, { timeout: 15_000 }).catch(() => {});
      expect(await text(page, 'seller-dashboard-store-name') === 'Night Shift Studio', 'dashboard header shows the onboarding business name');
      expect((await text(page, 'seller-dashboard-store-url')).includes('nightshiftstudio'), 'dashboard header link carries the onboarding @username');
      expect(await headerPhoto(page) > 0, 'dashboard header shows the profile photo, not the monogram');
      expect(!(await bodyHas(page, 'Maya Okafor')) && !(await bodyHas(page, 'northlinestudio')), 'dashboard shows no Clerk-only name/username');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, '01-dashboard-header-name-username-photo');

      await openSellerProfile(page, activity, 'seller-profile-messages-btn');
      await page.getByText('Night Shift Studio').first().waitFor({ timeout: 15_000 }).catch(() => {});
      expect(await bodyHas(page, 'Night Shift Studio'), 'profile shows the business name');
      expect(await bodyHas(page, '@nightshiftstudio'), 'profile shows the onboarding @username');
      expect(!(await bodyHas(page, 'My Brand')), 'profile shows no "My Brand" placeholder');
      await shot(page, '02-profile-name-username-photo');

      await open(page, activity, '/more');
      await page.getByText('Night Shift Studio').first().waitFor({ timeout: 15_000 }).catch(() => {});
      expect(await bodyHas(page, 'Night Shift Studio'), 'More account card shows the business name');
      await shot(page, '03-more-account-card');

      await open(page, activity, '/seller-settings');
      await page.getByText('Night Shift Studio').first().waitFor({ timeout: 15_000 }).catch(() => {});
      expect(await bodyHas(page, 'Night Shift Studio'), 'Settings shows the business name');
      expect(!(await bodyHas(page, 'Your Brandthread store')), 'Settings shows no placeholder store name');
      await shot(page, '04-settings-account-row');
      await context.close();
    }

    // ── 05-06 Propagation: set a photo + rename, see it on return ─────────
    {
      const state = defaultState();
      state.identity.photo = null;
      const { context, page, activity } = await seller(state);
      await open(page, activity, '/', 'seller-dashboard-store-name');
      await page.waitForTimeout(800);
      expect(await headerPhoto(page) === 0, 'no photo: header keeps the monogram fallback');
      expect(await page.locator('[data-testid="seller-dashboard-scroll-position"]').getByText('NS', { exact: true }).count() > 0, 'monogram reads NS (Night Shift)');
      await shot(page, '05-dashboard-no-photo-monogram');

      // The seller sets a photo and renames the store (server state changes)…
      state.identity = { ...state.identity, brandName: 'Night Shift Atelier', photo: PHOTO };
      // …moves on inside the app (dashboard → inbox) and comes back: the
      // dashboard regains focus without a reload (SPA history, no page load).
      const loads = [];
      page.on('load', () => loads.push(Date.now()));
      await page.getByTestId('seller-dashboard-messages').click();
      await page.waitForURL(/seller-inbox/, { timeout: 10_000 });
      await page.waitForTimeout(800);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('[data-testid="seller-dashboard-store-name"]')?.textContent === 'Night Shift Atelier', undefined, { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
      expect(await text(page, 'seller-dashboard-store-name') === 'Night Shift Atelier', 'dashboard shows the new name on return');
      expect(await headerPhoto(page) > 0, 'dashboard shows the new photo on return');
      expect(loads.length === 0, `no page reload between edit and return (${loads.length})`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, '06-dashboard-after-photo-and-rename');
      await openSellerProfile(page, activity, 'seller-profile-messages-btn');
      await page.getByText('Night Shift Atelier').first().waitFor({ timeout: 15_000 }).catch(() => {});
      expect(await bodyHas(page, 'Night Shift Atelier'), 'profile shows the new name too');
      await shot(page, '06b-profile-after-photo-and-rename');
      await context.close();
    }

    // ── 07-10 Incentive cards retire on server state ──────────────────────
    const stages = [
      ['07-incentives-new-seller-all-cards', { done: [], plan: null }, { checklist: true, plan: true, firstProduct: true }],
      ['08-incentives-plan-bought', { done: [], plan: 'starter' }, { checklist: true, plan: false, firstProduct: true }],
      ['09-incentives-first-product-live', { done: ['first_product'], plan: 'starter' }, { checklist: true, plan: false, firstProduct: false }],
      ['10-incentives-all-9-steps-done', { done: STEP_IDS, plan: 'starter' }, { checklist: false, plan: false, firstProduct: false }],
    ];
    for (const [name, flip, want] of stages) {
      const state = { ...defaultState(), ...flip, conversations: [] };
      const { context, page, activity } = await seller(state);
      await open(page, activity, '/', 'seller-dashboard-store-name');
      await page.waitForTimeout(1500);
      const got = {
        checklist: await count(page, 'seller-dashboard-ready-to-sell-count') > 0,
        plan: await count(page, 'seller-dashboard-ready-to-sell-plan') > 0,
        firstProduct: await count(page, 'seller-dashboard-setup-card') > 0,
      };
      for (const key of Object.keys(want)) expect(got[key] === want[key], `${name}: ${key} ${want[key] ? 'shown' : 'gone'}`);
      expect(!(await bodyHas(page, 'Select a plan')) === !want.plan, `${name}: "Select a plan" ${want.plan ? 'shown' : 'gone'}`);
      expect(!(await bodyHas(page, 'Get ready to sell')) === !want.checklist, `${name}: "Get ready to sell" ${want.checklist ? 'shown' : 'gone'}`);
      expect(!(await bodyHas(page, 'List your first product')) === !want.firstProduct, `${name}: "List your first product" ${want.firstProduct ? 'shown' : 'gone'}`);
      // All steps done fires the one-time "Your store is ready" celebration.
      try { await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 2000 }); await page.waitForTimeout(500); } catch {}
      const anchor = want.checklist ? 'seller-dashboard-ready-to-sell' : want.firstProduct ? 'seller-dashboard-setup-card' : null;
      if (anchor) await page.getByTestId(anchor).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
      else await page.getByText('Recent orders').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
      await shot(page, name);
      await context.close();
    }

    // ── 11-13 One-tap messages ────────────────────────────────────────────
    {
      const state = defaultState();
      const { context, page, activity } = await seller(state);
      await open(page, activity, '/', 'seller-dashboard-messages');
      await page.getByTestId('seller-dashboard-messages-badge').waitFor({ timeout: 15_000 }).catch(() => {});
      expect((await text(page, 'seller-dashboard-messages-badge')).trim() === '2', 'dashboard badge counts 2 unread threads (not 4 messages)');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, '11-dashboard-messages-icon-badge');
      await page.getByTestId('seller-dashboard-messages').click();
      await page.waitForURL(/seller-inbox/, { timeout: 10_000 }).catch(() => {});
      await waitForQuietNetwork(activity, 600, 8_000);
      expect(new URL(page.url()).pathname === '/seller-inbox', `dashboard icon opens /seller-inbox (at ${page.url()})`);
      expect(await bodyHas(page, 'Jordan Reyes') && !(await bodyHas(page, 'hit a problem')), 'inbox lists the threads');
      await shot(page, '12-dashboard-icon-opens-inbox');

      await openSellerProfile(page, activity, 'seller-profile-messages-btn');
      await page.getByTestId('seller-profile-messages-badge').waitFor({ timeout: 15_000 }).catch(() => {});
      expect((await text(page, 'seller-profile-messages-badge')).trim() === '2', 'profile Messages button badge shows 2 unread threads');
      const label = page.getByTestId('seller-profile-messages-btn');
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'profile Messages label fits its button');
      await shot(page, '13a-profile-messages-button');
      await page.getByTestId('seller-profile-messages-btn').click();
      await page.waitForURL(/seller-inbox/, { timeout: 10_000 }).catch(() => {});
      expect(new URL(page.url()).pathname === '/seller-inbox', `profile Messages opens /seller-inbox (at ${page.url()})`);
      await waitForQuietNetwork(activity, 600, 8_000);
      await shot(page, '13b-profile-messages-opens-inbox');
      await context.close();
    }

    // ── 14 Buyer: onboarding name + @username on the buyer profile ────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
      await context.addInitScript(() => {
        const get = Storage.prototype.getItem;
        Storage.prototype.getItem = function getItem(key) {
          if (key === 'bt:previewRole:seller-review-v2') return 'guest';
          return get.call(this, key);
        };
      });
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
      await context.route(/\/api\/(v1\/)?auth\/(me|sync)$/, (route) => (route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: cors })
        : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ...respond({ method: 'GET', path: '/auth/me', query: new URLSearchParams(), role: 'buyer' }), name: 'Ava Lin', displayName: 'Ava Lin', username: 'avalin', accountType: 'buyer', ageBand: '18_plus' }) })));
      await page.goto(`${origin}/profile`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 600, 10_000);
      await dismissChrome(page);
      // First-run welcome for a new buyer: enter, then back to the profile.
      try {
        await page.getByText('Enter the Thread').first().click({ timeout: 4000 });
        await page.waitForTimeout(800);
        await page.goto(`${origin}/profile`);
        await waitForQuietNetwork(activity, 600, 10_000);
        await dismissChrome(page);
      } catch {}
      await page.getByText('Ava Lin').first().waitFor({ timeout: 15_000 }).catch(() => {});
      expect(await bodyHas(page, 'Ava Lin'), 'buyer profile shows the onboarding name');
      expect(await bodyHas(page, '@avalin'), 'buyer profile shows the onboarding @username');
      expect(!(await bodyHas(page, 'Jordan Reyes')), 'buyer profile shows no Clerk-only name');
      await shot(page, '14-buyer-profile-name-username');
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
  console.log('\nAll identity / dashboard / messages checks passed.');
}

main().catch((error) => { console.error(error); process.exit(1); });
