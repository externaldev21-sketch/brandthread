#!/usr/bin/env node
/**
 * Dashboard icons + seller profile share relocation — hands-on at 390x844 in
 * the static web preview, signed-in seller against a stubbed API (same setup
 * as identity-dashboard-verify.mjs):
 *   01  dashboard top bar: Share + Messages drawn from the tab bar's own
 *       line-icon family (BuyerNavIcon svgs), badge still 2 unread threads,
 *       44pt tap targets unchanged; 01b a close crop of the top bar
 *   02  the same icons beside the seller tab bar (signed-out seller preview,
 *       where the bar is on screen) so the two read as one set
 *   03  seller profile row: Edit profile + white primary Messages, no Share
 *   04  ••• menu open with "Share profile"; 05 tapping it opens the share sheet
 *
 *   node scripts/store-screenshots/dashboard-icons-share-verify.mjs [--skip-build]
 *   (cloud containers: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome)
 *
 * Output: docs/screenshots/dashboard-icons-share/ (repo root)
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { IMAGE_HOST, SELLER_USER, respond } from './demo-data.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/screenshots/dashboard-icons-share');
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
  async function shot(page, name, clip) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
    console.log(`  ✓ ${name}`);
  }
  async function dismissChrome(page) {
    try { await page.getByText('Continue setup later', { exact: true }).click({ timeout: 4000 }); await page.waitForTimeout(500); } catch {}
    try { await page.getByText('Necessary only', { exact: true }).click({ timeout: 1500 }); } catch {}
    for (const t of ['Close', 'Not now', 'Skip for now', 'Skip', 'Got it', 'Maybe later']) {
      try { await page.getByRole('button', { name: t, exact: true }).first().click({ timeout: 500 }); } catch {}
    }
  }
  async function open(page, activity, route, readyTestId) {
    await page.goto(`${origin}${route}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
    if (readyTestId) await page.getByTestId(readyTestId).first().waitFor({ timeout: 25_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await dismissChrome(page);
  }
  const box = (page, testId) => page.getByTestId(testId).first().boundingBox();
  const bodyHas = async (page, s) => (await page.locator('body').innerText()).includes(s);
  /** The glyph is the tab-bar family's inline svg (round caps/joins), not a font icon. */
  const familySvg = (page, testId) => page.getByTestId(testId).first().evaluate((el) => {
    const svg = el.querySelector('svg');
    const stroke = svg?.querySelector('[stroke-linecap="round"][stroke-linejoin="round"]');
    return Boolean(svg && stroke && svg.getAttribute('viewBox') === '0 0 24 24');
  }).catch(() => false);

  try {
    const state = defaultState();
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images, apiOptions: { fresh: true } });
    await sellerApi(context, origin, state);

    // ── 01 Dashboard top bar ──────────────────────────────────────────────
    await open(page, activity, '/', 'seller-dashboard-messages');
    await page.getByTestId('seller-dashboard-messages-badge').waitFor({ timeout: 15_000 }).catch(() => {});
    expect(await familySvg(page, 'seller-dashboard-share-store'), 'Share uses the tab-bar line-icon family');
    expect(await familySvg(page, 'seller-dashboard-messages'), 'Messages uses the tab-bar line-icon family');
    const share = await box(page, 'seller-dashboard-share-store');
    const msgs = await box(page, 'seller-dashboard-messages');
    expect(share && Math.round(share.width) === 44 && Math.round(share.height) === 44, `Share tap target 44x44 (${share?.width}x${share?.height})`);
    expect(msgs && Math.round(msgs.width) === 44 && Math.round(msgs.height) === 44, `Messages tap target 44x44 (${msgs?.width}x${msgs?.height})`);
    expect(share && msgs && msgs.x > share.x && Math.abs(msgs.y - share.y) < 1, 'Messages sits right of Share on the same line');
    expect((await page.getByTestId('seller-dashboard-messages-badge').innerText().catch(() => '')).trim() === '2', 'badge still counts 2 unread threads');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '01-dashboard-top-bar-icons');
    await shot(page, '01b-dashboard-top-bar-closeup', { x: 0, y: 40, width: 390, height: 90 });

    // ── 03 Seller profile row ─────────────────────────────────────────────
    await open(page, activity, '/(tabs)/profile', 'seller-profile-messages-btn');
    expect(await page.getByTestId('seller-share-profile-btn').count() === 0, 'no Share profile button in the row');
    expect(await page.getByTestId('profile-edit-details').count() === 1, 'Edit profile stays');
    const edit = await box(page, 'profile-edit-details');
    const mbtn = await box(page, 'seller-profile-messages-btn');
    expect(edit && mbtn && Math.abs(edit.width - mbtn.width) < 1 && Math.abs(edit.y - mbtn.y) < 1, `Edit and Messages split the row evenly (${edit?.width} / ${mbtn?.width})`);
    const colors = await page.getByTestId('seller-profile-messages-btn').first().evaluate((el) => {
      // The fill sits on the button's own surface, which may be a child of the testID wrapper.
      const painted = [el, ...el.querySelectorAll('div')].find((d) => getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)');
      const bg = painted ? getComputedStyle(painted).backgroundColor : 'none';
      const label = [...el.querySelectorAll('div')].find((d) => d.textContent === 'Messages' && !d.children.length);
      return { bg, fg: label ? getComputedStyle(label).color : null };
    });
    expect(colors.bg === 'rgb(255, 255, 255)', `Messages button is white (${colors.bg})`);
    expect(colors.fg === 'rgb(0, 0, 0)', `Messages label is black (${colors.fg})`);
    expect((await page.getByTestId('seller-profile-messages-badge').innerText().catch(() => '')).trim() === '2', 'profile badge still shows 2');
    await shot(page, '03-profile-row-edit-and-white-messages');

    // ── 04-05 ••• menu → Share profile ────────────────────────────────────
    await page.getByTestId('seller-profile-more').click();
    await page.getByText('Share profile', { exact: true }).first().waitFor({ timeout: 10_000 });
    expect(await bodyHas(page, 'Share profile'), '••• menu lists Share profile');
    await shot(page, '04-three-dots-menu-share-profile');
    await page.getByText('Share profile', { exact: true }).first().click();
    await page.waitForTimeout(1200);
    expect(await page.getByText('@nightshiftstudio').count() > 0, 'Share profile opens the share sheet for @nightshiftstudio');
    await shot(page, '05-share-profile-opens-share-sheet');
    await context.close();

    // ── 02 Top bar beside the seller tab bar (preview, where the bar shows) ─
    {
      const { context: c2, page: p2, activity: a2 } = await openContext(browser, { device, role: 'seller', origin, images });
      await p2.goto(`${origin}/?bt_preview=seller&demo=1`);
      await waitForQuietNetwork(a2, 600, 10_000);
      await dismissChrome(p2);
      await p2.getByTestId('seller-dashboard-share-store').first().waitFor({ timeout: 20_000 });
      const bar = await p2.getByTestId('seller-global-tab-bar').count();
      expect(bar > 0, 'seller tab bar on screen for the side-by-side shot');
      await shot(p2, '02-top-bar-with-seller-tab-bar');
      await c2.close();
    }
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll dashboard icon / profile share checks passed.');
}

main().catch((error) => { console.error(error); process.exit(1); });
