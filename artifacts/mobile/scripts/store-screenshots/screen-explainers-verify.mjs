#!/usr/bin/env node
/**
 * One-time screen explainers, hands-on at 390x844 in the web preview.
 * For every covered screen on a fresh account: the explainer shows, sits
 * fully inside the viewport, dismisses (rotating Got it / X / tap outside),
 * and a revisit in the same session shows nothing.
 *
 * Runs on the plain preview build with `&tips=1` (the plain preview shows
 * no tips without it); seen-state holds there like for a real account.
 *
 *   node scripts/store-screenshots/screen-explainers-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, MOBILE_ROOT, DEFAULT_BUILD_DIR,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { respond } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'screen-explainers'));
const VIEWPORT = { width: 390, height: 844 };
const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined };

const SELLER = [
  ['explain-design-gallery', '/design'],
  ['explain-manufacturer-hub', '/manufacturer-hub'],
  ['seller-analytics', '/analytics'],
  ['seller-products', '/products'],
  ['seller-orders', '/orders'],
  ['explain-store-builder', '/store-builder'],
  ['explain-boost', '/boost'],
  ['explain-meta-ads', '/meta-ads-manage'],
  ['explain-popup-mode', '/popup-mode'],
  ['explain-payouts', '/payouts'],
  ['explain-plans', '/plans'],
  ['explain-go-live', '/seller-go-live'],
  ['explain-marketing', '/marketing'],
  ['explain-email-campaigns', '/email-campaigns'],
  ['explain-seller-drops', '/seller-drops'],
  ['explain-seller-giveaways', '/seller-giveaways'],
  ['explain-discounts', '/discounts'],
  ['explain-growth-links', '/growth-links'],
  ['explain-link-in-bio', '/link-in-bio'],
  ['explain-follower-push', '/seller-push-broadcast'],
  ['explain-creator-program', '/seller-creator-program'],
  ['explain-membership-levels', '/membership-levels'],
  ['explain-rfq-list', '/rfq-list'],
];
const BUYER = [
  ['buyer-discover', '/discover'],
  ['explain-thread-cash', '/thread-cash'],
  ['explain-bag', '/cart'],
  ['explain-checkout', '/buyer-checkout'],
  ['explain-buyer-orders', '/orders'],
  ['explain-live-feed', '/live-feed'],
  ['explain-buyer-drops', '/buyer-drops'],
  ['explain-community', '/community'],
];
const DISMISS = ['ok', 'close', 'outside'];

const sheetSel = (id) => `[data-testid="first-run-tip-explainer-${id}"]`;

async function waitForSheet(page, id, timeout = 12_000) {
  return page.locator(sheetSel(id)).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
}

async function dismiss(page, how) {
  if (how === 'ok') await page.locator('[data-testid="first-run-tip-explainer-ok"]').first().click();
  else if (how === 'close') await page.locator('[data-testid="first-run-tip-explainer-close"]').first().click();
  else await page.mouse.click(VIEWPORT.width / 2, 60); // the scrim, well above the card
  await page.waitForTimeout(400);
}

async function cardBox(page) {
  const ok = page.locator('[data-testid="first-run-tip-explainer-ok"]').first();
  const close = page.locator('[data-testid="first-run-tip-explainer-close"]').first();
  return { ok: await ok.boundingBox(), close: await close.boundingBox() };
}

function inside(b) {
  return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= VIEWPORT.width && b.y + b.height <= VIEWPORT.height;
}

/** Client-side navigation right after the first load can land back on "/"; retry until on the route. */
async function go(page, activity, origin, role, route) {
  const [want, query] = route.split('?');
  for (let attempt = 0; attempt < 3; attempt++) {
    await openScreen(page, activity, origin, role, want, { extraQuery: `&tips=1${query ? `&${query}` : ''}` });
    await waitForQuietNetwork(activity, 600, 12_000).catch(() => {});
    if (new URL(page.url()).pathname === want) return true;
  }
  return false;
}

async function check(page, activity, origin, role, id, route, i, results, extra) {
  await go(page, activity, origin, role, route);
  // The seller's first load of "/" shows the dashboard tour; it gives up the
  // slot when we navigate away, so the explainer follows.
  const shown = await waitForSheet(page, id);
  let fits = false, gone = false, revisitClean = false;
  const how = DISMISS[i % DISMISS.length];
  if (shown) {
    await page.waitForTimeout(350);
    const { ok, close } = await cardBox(page);
    fits = inside(ok) && inside(close);
    await page.screenshot({ path: path.join(OUT, `${role}-${id}.png`) });
    await dismiss(page, how);
    gone = (await page.locator(sheetSel(id)).count()) === 0;
    if (extra) await extra();
  }
  await go(page, activity, origin, role, route);
  revisitClean = !(await waitForSheet(page, id, 2500));
  results.push({ role, id, route, shown, fits, dismissedWith: how, gone, revisitClean });
  console.log(JSON.stringify(results.at(-1)));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const results = [];
  try {
    for (const [role, list] of [['seller', SELLER], ['buyer', BUYER]]) {
      const { context, page, activity } = await openContext(browser, { device, role, origin, images });
      // The demo accounts have no age band, so Payouts / Go live would stop
      // at the date-of-birth gate (lib/ageGate.ts). Report an adult account.
      await page.route(/\/auth\/me(\?|$)/, (r) => r.fulfill({
        json: { ...respond({ method: 'GET', path: '/auth/me', query: {}, role }), ageBand: '18_plus' },
      }));
      // Checkout renders its real page only when live (build with
      // EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_demo).
      await page.route(/\/api\/public\/checkout-config/, (r) => r.fulfill({ json: { live: true } }));
      // Warm-up: the home screen's own first-run tip shows on the very first
      // load and the harness's first client-side push can race it. A fresh
      // user has always seen home before any other screen anyway.
      await openScreen(page, activity, origin, role, '/', { extraQuery: '&tips=1' });
      await page.waitForTimeout(3000);
      for (const [i, [id, route]] of list.entries()) {
        // After the gallery's explainer, open a new canvas from it: the
        // canvas has its own explainer for the tools.
        const extra = id === 'explain-design-gallery' ? async () => {
          await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(500);
          await page.locator('[data-testid="preset-screen"]').first().click({ timeout: 5000 }).catch(() => {});
          const cid = 'explain-design-canvas';
          const shown = await waitForSheet(page, cid, 10_000);
          let fits = false, gone = false;
          if (shown) {
            await page.waitForTimeout(350);
            const { ok, close: x } = await cardBox(page);
            fits = inside(ok) && inside(x);
            await page.screenshot({ path: path.join(OUT, `seller-${cid}.png`) });
            await dismiss(page, 'close');
            gone = (await page.locator(sheetSel(cid)).count()) === 0;
          }
          results.push({ role, id: cid, route: '/design-canvas (new canvas)', shown, fits, dismissedWith: 'close', gone, revisitClean: null });
          console.log(JSON.stringify(results.at(-1)));
        } : undefined;
        await check(page, activity, origin, role, id, route, i, results, extra);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await close();
  }
  const bad = results.filter((r) => !r.shown || !r.fits || !r.gone || r.revisitClean === false);
  console.log(`\n${results.length} screens checked, ${bad.length} with problems`);
  for (const r of bad) console.log('PROBLEM', JSON.stringify(r));
}

main().catch((e) => { console.error(e); process.exit(1); });
