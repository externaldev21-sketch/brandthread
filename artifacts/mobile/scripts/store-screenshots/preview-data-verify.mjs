#!/usr/bin/env node
/**
 * Preview-mode data completeness (follow state + orders), verified on a local
 * replica of the owner's live Replit preview (…replit.dev/?bt_preview=…):
 * the DEV bundle (`expo start --web`, __DEV__ on — what Replit serves), with
 * no account: every non-public API call answers 401, exactly like the real
 * API does for a signed-out preview. Public endpoints (/api/public/*) get the
 * harness's demo answers. Activity is reached the way the owner does — the
 * buyer tab bar's Activity slot, or the seller dashboard's bell.
 *
 * Proves, for buyer and seller:
 *   1. a single "Follow back" pill exists, and follow / unfollow / follow back
 *      stick (no 401 roll-back) and survive leaving + re-entering Activity;
 *   2. the grouped "New followers" list and "Suggested for you" follow sticks;
 *   3. the seeded "Your order shipped" row opens a real order, not
 *      "Could not load order details", and stays loaded past the 15s refetch.
 *
 * Usage: start the dev server (see activity-dev-preview-verify.mjs), then
 *   node scripts/store-screenshots/preview-data-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/preview-follow-orders'));
mkdirSync(OUT, { recursive: true });

async function run(browser, images, role) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  const calls = [];
  // No account: everything but the public catalogue is 401.
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !/^\/api(\/v1)?\/public\//.test(url.pathname), (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls.push(`${req.method()} ${new URL(req.url()).pathname.replace(/^\/api\/v1/, '/api')}`);
    return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  page.setDefaultNavigationTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const settle = async (ms = 1500) => { await waitForQuietNetwork(activity, 500, 10_000); await page.waitForTimeout(ms); };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const pillText = async (userId) => (await page.getByTestId(`activity-follow-${userId}`).first().innerText().catch(() => '(none)')).trim();
  const results = {};

  const openActivity = async (fresh) => {
    for (let attempt = 1; ; attempt += 1) {
      if (fresh || attempt > 1) {
        await openScreen(page, activity, ORIGIN, role, role === 'buyer' ? '/' : '/(tabs)');
        await settle(2000);
      }
      const later = page.getByText('Continue setup later');
      if (await later.count()) { await later.first().click().catch(() => {}); await settle(800); }
      const entry = role === 'buyer' ? page.getByTestId('buyer-tab-activity').first() : page.getByTestId('seller-dashboard-activity').first();
      try {
        await entry.click({ timeout: 20_000 });
        await page.getByTestId('activity-chip-follows').first().waitFor({ timeout: 20_000 });
        break;
      } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(2500);
  };
  const leaveActivity = async () => {
    if (role === 'buyer') await page.getByTestId('buyer-tab-index').first().click().catch(() => {});
    else await page.goBack();
    await settle(1500);
  };

  // ── 1. Single Follow back pill ──────────────────────────────────────────
  await openActivity(true);
  await page.getByTestId('activity-chip-follows').first().click();
  await settle(900);
  await shot('01-follows-single-follow-back');
  const single = 'preview-seller-01'; // Atelier Noire
  results.singlePillBefore = await pillText(single);
  await page.getByTestId(`activity-follow-${single}`).first().click();
  await settle(2500); // well past the 401 that used to roll it back
  results.singlePillAfterFollow = await pillText(single);
  await shot('02-follow-back-stuck');

  await leaveActivity();
  await openActivity(false);
  await page.getByTestId('activity-chip-follows').first().click();
  await settle(900);
  results.singlePillAfterRevisit = await pillText(single);

  await page.getByTestId(`activity-follow-${single}`).first().click();
  await page.getByText('Unfollow', { exact: true }).first().click();
  await settle(2500);
  results.singlePillAfterUnfollow = await pillText(single);
  await shot('03-unfollow-stuck');

  // ── 2. Grouped "New followers" list + Suggested for you ─────────────────
  await page.locator('[aria-label*="Saint Rue and Kuro Line"]').first().click();
  await settle(2500);
  results.groupedListPath = new URL(page.url()).pathname;
  const saintRue = page.locator('[aria-label="Follow back Saint Rue"]').first();
  results.groupedHasFollowBack = await saintRue.count();
  if (results.groupedHasFollowBack) {
    await saintRue.click();
    await settle(2500);
    results.groupedAfterFollow = await page.locator('[aria-label="Unfollow Saint Rue"]').count() ? 'Following' : 'rolled back';
  }
  await shot('04-new-followers-list-follow-stuck');
  await page.goBack();
  await settle(1500);

  await page.getByTestId('activity-chip-all').first().click();
  await settle(900);
  // First "Suggested for you" row (the last ones sit under the floating tab bar).
  await page.getByText('Suggested for you').first().scrollIntoViewIfNeeded().catch(() => {});
  await settle(600);
  // Other mounted tabs (e.g. Discover's follow-btn-*) have Follow buttons
  // too; the Suggested rows' buttons are the ones without a testID.
  const suggestFollow = page.locator('[aria-label^="Follow "]:not([aria-label^="Follow back"]):not([data-testid])').first();
  const suggestLabel = await suggestFollow.getAttribute('aria-label').catch(() => null);
  results.suggestedTapped = suggestLabel;
  if (suggestLabel) {
    await suggestFollow.click();
    await settle(2500);
    const name = suggestLabel.replace(/^Follow /, '');
    const suggestedPill = () => page.locator(`[aria-label="Follow ${name}"]:not([data-testid])`);
    results.suggestedAfterFollow = await suggestedPill().count() === 0 ? 'Following' : 'rolled back';
    await shot('05-suggested-follow-stuck');
    await leaveActivity();
    await openActivity(false);
    await page.getByText('Suggested for you').first().scrollIntoViewIfNeeded().catch(() => {});
    await settle(900);
    results.suggestedAfterRevisit = await suggestedPill().count() === 0 ? 'still Following' : 'reset to Follow';
  }

  // ── 3. Seeded order row opens a real order ──────────────────────────────
  await page.getByTestId('activity-chip-orders').first().click();
  await settle(900);
  await page.getByText('Your order shipped').first().click();
  await settle(3000);
  results.orderPath = new URL(page.url()).pathname + new URL(page.url()).search.replace(/[?&]bt_preview=[^&]*/, '');
  const text1 = await page.locator('body').innerText();
  results.orderLoaded = text1.includes('BT-10428') && text1.includes('Sculpted Wool Coat');
  results.orderError = text1.includes('Could not load order details');
  await shot('06-order-detail');
  await page.waitForTimeout(16_000); // past the screen's 15s refetch
  const text2 = await page.locator('body').innerText();
  results.orderStillLoadedAfterRefetch = text2.includes('BT-10428') && !text2.includes('Could not load order details');

  results.followCalls = [...new Set(calls.filter((c) => c.includes('/social/follow')))];
  await context.close();
  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    for (const role of roles) {
      const results = await run(browser, images, role);
      console.log(`\n[${role}]`, JSON.stringify(results, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
