#!/usr/bin/env node
/**
 * F7 billing screenshots (items 115 dunning + 116 annual plans) at 393×852 @2x.
 *
 *   node scripts/f7-billing-screenshots.mjs --prefix after  [--skip-build] [--build-dir <dir>]
 *   node scripts/f7-billing-screenshots.mjs --prefix before --build-dir <dir-built-from-origin/dev> --skip-build
 *
 * Writes docs/pr-assets/f7/billing/<prefix>-*.png. The subscription status
 * (past due with retry 2 of 3, and paused) comes from a fake API route
 * registered on top of the harness's demo API.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const prefix = flag('--prefix', 'after');
const buildDir = path.resolve(flag('--build-dir', DEFAULT_BUILD_DIR));
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/f7/billing');
mkdirSync(OUT, { recursive: true });

if (!args.includes('--skip-build')) buildPreviewWeb(buildDir);

const STATUS_BASE = {
  plan: 'growth', trialEnd: null, trialStartAt: null, trialEndAt: null, trialBanner: null,
  renewsOn: 'Oct 14, 2026', amountCents: 7900, interval: 'month', paymentMethodLabel: 'Visa ···· 4242',
  effectiveProvider: 'stripe', native: null,
};
const STATUSES = {
  retrying: {
    ...STATUS_BASE, status: 'past_due',
    dunning: { state: 'retrying', retryNumber: 2, maxRetries: 3, nextRetryAt: '2026-09-22T17:00:00.000Z' },
  },
  paused: {
    ...STATUS_BASE, status: 'paused',
    dunning: { state: 'paused', pausedAt: '2026-09-18T17:00:00.000Z', maxRetries: 3 },
  },
};

const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
const { origin, close } = await serveBuild(buildDir);
const browser = await launchBrowser();

async function shot(name, target, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await shotOnce(name, target, opts); } catch (error) {
      if (attempt >= 4) throw error;
      console.log(`retrying ${name}: ${String(error.message).split('\n')[0]}`);
    }
  }
}

async function shotOnce(name, target, { status, steps } = {}) {
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  if (status) {
    // Registered after openContext, so it wins over the harness catch-all
    // (which still answers the CORS preflight).
    await context.route('**/seller/subscription/status', (route) => (route.request().method() === 'OPTIONS'
      ? route.fallback()
      : route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        contentType: 'application/json',
        body: JSON.stringify(status),
      })));
  }
  // The preview build answers every seller API call with "unavailable in the
  // signed-out seller preview". Once the app has booted as the demo seller,
  // window.__btLive hides the preview markers (?bt_preview, user_role) from
  // lib/devPreview.ts so screens call the fake API above like a signed-in owner.
  await context.addInitScript(() => {
    const get = URLSearchParams.prototype.get;
    URLSearchParams.prototype.get = function (key) { return window.__btLive && key === 'bt_preview' ? null : get.call(this, key); };
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) { return window.__btLive && key === 'user_role' ? null : getItem.call(this, key); };
  });
  if (target === '/subscription') {
    // A direct load of /subscription bounces to the dashboard in the preview
    // build; open it the way a seller does: Settings → Subscription.
    for (let attempt = 0; attempt < 4; attempt++) {
      await openScreen(page, activity, origin, 'seller', '/seller-settings');
      await page.waitForTimeout(2500);
      const row = page.getByText('Subscription', { exact: true }).first();
      if (!(await row.isVisible().catch(() => false)) && !(await row.count())) continue;
      await page.evaluate(() => { window.__btLive = true; });
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(1500);
      if (new URL(page.url()).pathname === '/subscription') break;
    }
  } else {
    await openScreen(page, activity, origin, 'seller', target);
  }
  await page.waitForTimeout(2500);
  await waitForQuietNetwork(activity).catch(() => {});
  try { await steps?.(page); } catch (error) { await context.close(); throw error; }
  await page.waitForTimeout(800);
  const file = path.join(OUT, `${prefix}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
  await context.close();
}

const scrollTo = (text) => async (page) => {
  const target = text.startsWith('#') ? page.getByTestId(text.slice(1)) : page.getByText(text, { exact: false });
  await target.first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(400);
};

try {
  // Plans: plan cards (monthly) and, on this branch, yearly.
  const plansAnchor = prefix === 'before' ? 'Trusted by independent brands' : 'Monthly';
  await shot('plans-monthly', '/plans', { steps: scrollTo(plansAnchor) });
  if (prefix !== 'before') {
    await shot('plans-yearly', '/plans', {
      steps: async (page) => {
        await page.getByText(/^Yearly/).first().click();
        await scrollTo('Monthly')(page);
      },
    });
  }
  // Subscription: plan tab + billing tab, past due (retry 2 of 3) and paused.
  for (const [state, status] of Object.entries(STATUSES)) {
    if (prefix === 'before' && state === 'paused') continue; // dev has no paused state
    await shot(`subscription-${state}-plan`, '/subscription', { status });
    await shot(`subscription-${state}-billing`, '/subscription', {
      status,
      steps: async (page) => { await page.getByText('Billing', { exact: true }).first().click(); },
    });
  }
} finally {
  await browser.close();
  close();
}
