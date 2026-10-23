#!/usr/bin/env node
/**
 * One-off live verification for saved items alerts (restock + price drop) —
 * not part of the store screenshot pipeline. Production web export + a fake
 * API answering GET /api/buyer/notifications with exactly the rows the
 * backend publishes (api-server lib/stockNotifications.ts), and
 * /api/notification-prefs with the buyer response shape. Captures the
 * Activity Center, the notifications screen, the PDP a tap opens, and the
 * Saved items alerts toggle, at 390x844.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/saved-alerts-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/screenshots/saved-alerts'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();

// savedAlertCopy() in api-server lib/stockNotifications.ts.
const PRICE_DROP = {
  id: 'n-price', category: 'stock', type: 'price_drop',
  title: 'Price drop: Onyx Anorak now $158.00',
  body: 'An item you saved is now available at a lower price.',
  isRead: false, isMuted: false, targetType: 'product', targetId: 'prod_ea_jacket_onyx',
  targetImageUrl: `${IMAGE_HOST}/jacket-onyx.jpg`, cta: 'View item', createdAt: iso(4 * MIN),
};
const RESTOCK = {
  id: 'n-restock', category: 'stock', type: 'back_in_stock',
  title: 'Back in stock: Field Shell Jacket — Rust',
  body: 'An item you saved is available again.',
  isRead: false, isMuted: false, targetType: 'product', targetId: 'prod_nl_jacket_rust',
  targetImageUrl: `${IMAGE_HOST}/jacket-rust.jpg`, cta: 'View item', createdAt: iso(52 * MIN),
};
const FEED = [PRICE_DROP, RESTOCK];

// notification-prefs.ts GET / for a buyer (BUYER_DEFAULTS + channelView).
const BUYER_KEYS = ['order_updates', 'messages', 'new_drops', 'friend_activity', 'price_alerts', 'saved_alerts', 'return_updates', 'cart_reminders'];
const EMAIL_OFF = new Set(['messages', 'new_drops', 'friend_activity', 'price_alerts', 'saved_alerts']);
let categories = {
  new_drops: true, messages: true, order_updates: true, friend_activity: true, price_alerts: true,
  saved_alerts: true, return_updates: true, cart_reminders: true, seller_announcements: true,
};
const prefs = () => ({
  digest: 'realtime', role: 'buyer', pushEnabled: true, promotionalPush: true,
  quietHours: { start: null, end: null, timezone: 'UTC' },
  categories,
  channels: {
    push: Object.fromEntries(BUYER_KEYS.map((k) => [k, categories[k] ?? true])),
    inApp: Object.fromEntries(BUYER_KEYS.map((k) => [k, true])),
    email: Object.fromEntries(BUYER_KEYS.map((k) => [k, !EMAIL_OFF.has(k)])),
  },
});

async function installFakeApi(context) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test'
    && /^\/api\/(buyer\/notifications(\/.*)?|notification-prefs)$/.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    if (p === '/api/notification-prefs') {
      if (req.method() === 'PUT') categories = { ...categories, ...(req.postDataJSON()?.categories ?? {}) };
      return json(prefs());
    }
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(FEED);
    if (p === '/api/buyer/notifications/unread-count') return json({ count: FEED.length, latestId: FEED[0].id });
    return json({ ok: true });
  });
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const results = {};
  try {
    const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    await installFakeApi(context);
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const settle = async (ms = 600) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
    const open = async (target, ready) => {
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'buyer', target);
        try { await page.getByText(ready).first().waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
      }
      await settle();
    };

    await open('/activity-center', PRICE_DROP.title);
    await shot('01-activity-center');

    await open('/buyer-notifications', PRICE_DROP.title);
    await shot('02-notifications-screen');

    // Tapping each alert opens that product's PDP.
    for (const [screen, row, name] of [
      ['/activity-center', PRICE_DROP, '03-price-drop-tap-opens-pdp'],
      ['/buyer-notifications', RESTOCK, '04-restock-tap-opens-pdp'],
    ]) {
      await open(screen, row.title);
      await page.getByText(row.title).first().click();
      await page.waitForURL(/buyer-product-detail/, { timeout: 10_000 });
      await settle(1200);
      const url = new URL(page.url());
      results[`${screen} -> ${row.type}`] = `${url.pathname}?productId=${url.searchParams.get('productId')}`;
      await shot(name);
    }

    await open('/notifications-settings', 'Saved items alerts');
    await shot('05-settings-saved-items-alerts-toggle');

    await context.close();
  } finally {
    await close();
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
