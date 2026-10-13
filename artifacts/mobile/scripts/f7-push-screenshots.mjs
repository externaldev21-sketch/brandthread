#!/usr/bin/env node
/**
 * F7 push (items 99-103) screenshots at 393x852 @2x on the web preview.
 *
 *   node scripts/f7-push-screenshots.mjs [--skip-build]
 *
 * - Buyer Settings → "Notifications" now opens the real, persisted
 *   /notifications-settings (role buyer) instead of the local-state stub
 *   /push-notifications. The stub file is unchanged, so its "before" shot is
 *   taken from this same build.
 * - Seller /notifications-settings (unchanged look).
 * - Quiet hours: picking "11 PM – 8 AM" sends the device time zone; the PUT
 *   body is captured and written to quiet-hours-put.json.
 *
 * Output: docs/pr-assets/f7/push/
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'f7', 'push');
const BUILD_DIR = process.env.F7_BUILD_DIR || DEFAULT_BUILD_DIR;
const DEMO_API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};

const BUYER_KEYS = ['order_updates', 'messages', 'new_drops', 'friend_activity', 'price_alerts', 'return_updates', 'cart_reminders', 'seller_announcements'];
const SELLER_KEYS = ['new_orders', 'production_milestones', 'payout_confirmations', 'customer_messages', 'disputes', 'subscription_trial', 'inventory_alerts', 'seller_announcements'];

function prefsFor(role, state) {
  const keys = role === 'buyer' ? BUYER_KEYS : SELLER_KEYS;
  const categories = Object.fromEntries(keys.map((k) => [k, state.categories[k] ?? true]));
  return {
    digest: 'realtime',
    role,
    pushEnabled: true,
    promotionalPush: false,
    quietHours: { start: state.quietHours?.start ?? null, end: state.quietHours?.end ?? null, timezone: state.quietHours?.timezone ?? 'UTC' },
    categories,
    channels: {
      push: categories,
      inApp: Object.fromEntries(keys.map((k) => [k, true])),
      email: Object.fromEntries(keys.map((k) => [k, true])),
    },
  };
}

const puts = [];

async function withPrefs(context, role, state) {
  // Registered after openContext's catch-all, so Playwright tries it first.
  await context.route((url) => url.origin === DEMO_API && url.pathname.endsWith('/notification-prefs'), async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,PUT,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() || '{}');
      puts.push({ role, body });
      if (body.categories) Object.assign(state.categories, body.categories);
      if (body.quietHours !== undefined) state.quietHours = body.quietHours;
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(prefsFor(role, state)) });
  });
}

async function openReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(900);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target)) return;
  }
  throw new Error(`Navigation to ${target} never took effect`);
}

async function settle(page, activity) {
  await waitForQuietNetwork(activity, 800, 12_000);
  await page.waitForTimeout(900);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const unseeded = new Set();
  try {
    // ── Buyer ────────────────────────────────────────────────────────────
    {
      const state = { categories: { friend_activity: false }, quietHours: { start: null, end: null } };
      const { context, page, activity } = await openContext(browser, {
        device: DEVICE, role: 'buyer', origin, images: {}, onUnseeded: (r) => unseeded.add(r),
      });
      await withPrefs(context, 'buyer', state);

      // Before: what the buyer Settings row opened on dev (file unchanged).
      await openReliably(page, activity, origin, 'buyer', '/push-notifications');
      await settle(page, activity);
      await page.screenshot({ path: path.join(OUT, 'before-buyer-notifications.png') });

      // Settings → Notifications row → lands on /notifications-settings.
      await openReliably(page, activity, origin, 'buyer', '/buyer-settings');
      await settle(page, activity);
      const row = page.getByText('Notifications', { exact: true }).last();
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, 'after-buyer-settings-row.png') });
      await row.click();
      await page.waitForURL(/notifications-settings/, { timeout: 10_000 });
      await settle(page, activity);
      console.log('buyer row opened', new URL(page.url()).pathname);
      await page.screenshot({ path: path.join(OUT, 'after-buyer-notifications.png') });

      // Quiet hours → 11 PM – 8 AM (sends the device time zone).
      await page.getByTestId('quiet-hours-row').click();
      await page.waitForTimeout(700);
      await page.getByText('11 PM – 8 AM', { exact: true }).last().click();
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.mouse.move(196, 700);
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, 'after-buyer-notifications-quiet-hours.png') });
      await context.close();
    }

    // ── Seller ───────────────────────────────────────────────────────────
    {
      const state = { categories: {}, quietHours: { start: '23:00', end: '08:00', timezone: 'America/Los_Angeles' } };
      const { context, page, activity } = await openContext(browser, {
        device: DEVICE, role: 'seller', origin, images: {}, onUnseeded: (r) => unseeded.add(r),
      });
      await withPrefs(context, 'seller', state);
      await openReliably(page, activity, origin, 'seller', '/notifications-settings');
      await settle(page, activity);
      await page.screenshot({ path: path.join(OUT, 'after-seller-notifications.png') });
      await page.mouse.move(196, 700);
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, 'after-seller-notifications-scrolled.png') });
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  writeFileSync(path.join(OUT, 'quiet-hours-put.json'), `${JSON.stringify(puts, null, 2)}\n`);
  console.log('PUTs', JSON.stringify(puts));
  if (unseeded.size) console.log('unseeded', [...unseeded].join(', '));
}

main().catch((err) => { console.error(err); process.exit(1); });
