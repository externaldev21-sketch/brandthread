#!/usr/bin/env node
/**
 * F7 sms (item 105) screenshots at 393x852 @2x on the web preview.
 *
 *   node scripts/f7-sms-screenshots.mjs [--skip-build]
 *
 * - before-notifications-settings.png: buyer /notifications-settings with the
 *   server reporting SMS unavailable (no Twilio keys) — identical to dev: the
 *   new row only renders when `available` is true.
 * - after-notifications-settings.png: same screen, available=true.
 * - after-sms-off.png / after-sms-filled.png / after-sms-code.png /
 *   after-sms-success.png / after-sms-on.png: the /sms-order-updates flow.
 *
 * Fake API only (`&demo=1`); nothing reaches a real server.
 * Output: docs/pr-assets/f7/sms/
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'f7', 'sms');
const BUILD_DIR = process.env.F7_BUILD_DIR || DEFAULT_BUILD_DIR;
const DEMO_API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};
const BUYER_KEYS = ['order_updates', 'messages', 'new_drops', 'friend_activity', 'price_alerts', 'return_updates', 'cart_reminders', 'seller_announcements'];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-store-context',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
};

function buyerPrefs() {
  const on = Object.fromEntries(BUYER_KEYS.map((k) => [k, true]));
  return {
    digest: 'realtime', role: 'buyer', pushEnabled: true, promotionalPush: false,
    quietHours: { start: null, end: null, timezone: 'America/New_York' },
    categories: on, channels: { push: on, inApp: on, email: on },
  };
}

/** Routes registered after openContext's catch-all are tried first by Playwright. */
async function fakeApi(context, sms) {
  const json = (route, body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(/\/api\/(v1\/)?notification-prefs$/, (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : json(route, buyerPrefs()));
  await context.route(/\/api\/(v1\/)?notification-prefs\/sms(\/verify)?$/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      if (!body.enabled) { sms.enabled = false; return json(route, sms); }
      return json(route, { ...sms, codeSentTo: '+15551234567' });
    }
    if (req.method() === 'POST' && url.pathname.endsWith('/verify')) {
      Object.assign(sms, { phone: '+15551234567', enabled: true });
      return json(route, sms);
    }
    return json(route, sms);
  });
}

async function settle(page, activity) {
  await waitForQuietNetwork(activity, 800, 12_000);
  await page.waitForTimeout(900);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('wrote', name);
}

async function session(browser, origin, sms, target) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images: {} });
  await fakeApi(context, sms);
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('  CONSOLE', m.text().slice(0, 300)); });
  page.on('request', (r) => { if (r.url().includes('notification-prefs')) console.log('  ', r.method(), new URL(r.url()).pathname); });
  // A full load of the target keeps `&demo=1` in the URL while the screen
  // mounts (a client-side pushState mounts it before the URL updates).
  await page.goto(`${origin}${target}?bt_preview=buyer&demo=1`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  if (!(await page.evaluate(() => window.location.pathname)).startsWith(target)) {
    throw new Error(`Navigation to ${target} never took effect`);
  }
  await settle(page, activity);
  return { context, page, activity };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  try {
    {
      const { context, page } = await session(browser, origin, { available: false, phone: null, enabled: false }, '/notifications-settings');
      await page.mouse.move(196, 500);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(600);
      await shot(page, 'before-notifications-settings.png');
      await context.close();
    }
    {
      const { context, page } = await session(browser, origin, { available: true, phone: null, enabled: false }, '/notifications-settings');
      await page.mouse.move(196, 500);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(600);
      await shot(page, 'after-notifications-settings.png');
      await context.close();
    }
    {
      const sms = { available: true, phone: null, enabled: false };
      const { context, page, activity } = await session(browser, origin, sms, '/sms-order-updates');
      await shot(page, 'after-sms-off.png');
      await page.getByTestId('sms-phone-input').fill('(555) 123-4567');
      await page.locator('[data-testid="sms-consent-row"] [role="switch"]').first().click();
      await page.waitForTimeout(500);
      await shot(page, 'after-sms-filled.png');
      await page.getByTestId('sms-turn-on').click();
      await settle(page, activity);
      await page.getByTestId('sms-code-input').fill('123456');
      await page.waitForTimeout(400);
      await shot(page, 'after-sms-code.png');
      await page.getByTestId('sms-confirm').click();
      await settle(page, activity);
      await page.waitForTimeout(800);
      await shot(page, 'after-sms-success.png');
      await page.getByText('Done', { exact: true }).last().click();
      await page.waitForTimeout(900);
      await shot(page, 'after-sms-on.png');
      await context.close();
    }
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
