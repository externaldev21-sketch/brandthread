#!/usr/bin/env node
/**
 * Explainer carousel + pruned rollout, hands-on at 390x844 on the plain
 * preview build with `&tips=1`:
 *  - Design Studio: 1 / 3 → a real touch swipe → 2 / 3 → tap the card →
 *    3 / 3 → Got it closes it.
 *  - Manufacturer Hub: X bails from the first card.
 *  - Analytics: Next → 2 / 3, then a tap outside bails mid-carousel.
 *  - All three: leave → return shows nothing, and nothing after a reload.
 *  - Every other kept screen still shows its carousel; every pruned screen
 *    shows nothing on a fresh account.
 *
 *   node scripts/store-screenshots/explainer-carousel-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, MOBILE_ROOT, DEFAULT_BUILD_DIR,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { respond } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'explainer-carousel'));
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };

const KEPT_SELLER = [
  ['explain-popup-mode', '/popup-mode'],
  ['explain-payouts', '/payouts'],
  ['explain-boost', '/boost'],
  ['explain-create-ad', '/design-campaign'],
];
const KEPT_BUYER = [
  ['buyer-discover', '/discover'],
  ['explain-thread-cash', '/thread-cash'],
];
const PRUNED_SELLER = [
  '/orders', '/products', '/marketing', '/store-builder', '/plans', '/seller-go-live', '/meta-ads-manage',
  '/email-campaigns', '/seller-drops', '/seller-giveaways', '/discounts', '/growth-links', '/link-in-bio',
  '/seller-push-broadcast', '/seller-creator-program', '/membership-levels', '/rfq-list',
];
const PRUNED_BUYER = ['/cart', '/buyer-checkout', '/orders', '/live-feed', '/buyer-drops', '/community'];

const sheet = (id) => `[data-testid="first-run-tip-explainer-${id}"]`;
// Every explainer has the X, whichever card it's on.
const ANY_EXPLAINER = '[data-testid="first-run-tip-explainer-close"]';

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };

async function nav(page, activity, route) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, route);
    await waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
    await page.waitForTimeout(800);
    if (new URL(page.url()).pathname === route) return true;
  }
  return false;
}

const visible = (page, sel, timeout) => page.locator(sel).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const count = (page) => page.getByTestId('first-run-tip-explainer-count').first().innerText().catch(() => '');

/** A real one-finger swipe (CDP touch events) right-to-left across the cards. */
async function swipe(page) {
  const box = await page.getByTestId('first-run-tip-explainer-pager').first().boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 20, to = box.x + 20;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * i) / 12, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
}

async function open(browser, role, origin, images) {
  const ctx = await openContext(browser, { device, role, origin, images });
  // Demo accounts have no age band; report an adult so Payouts isn't the DOB gate.
  await ctx.page.route(/\/auth\/me(\?|$)/, (r) => r.fulfill({
    json: { ...respond({ method: 'GET', path: '/auth/me', query: {}, role }), ageBand: '18_plus' },
  }));
  await ctx.page.goto(`${origin}/?bt_preview=${role}&tips=1`);
  await ctx.page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(ctx.activity, 800, 15_000);
  await ctx.page.waitForTimeout(2500);
  return ctx;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  try {
    // ── Seller: the carousel itself ─────────────────────────────────────
    let { context, page, activity } = await open(browser, 'seller', origin, images);

    await nav(page, activity, '/design');
    check(await visible(page, sheet('explain-design-gallery'), 12_000), 'Design Studio: explainer shows');
    check((await count(page)) === '1 / 3', `Design Studio: starts at 1 / 3 (${await count(page)})`);
    await shot(page, '01-design-card1');
    await swipe(page);
    check((await count(page)) === '2 / 3', `Design Studio: touch swipe → 2 / 3 (${await count(page)})`);
    await shot(page, '02-design-card2-after-swipe');
    await page.getByTestId('first-run-tip-explainer-step-1').first().click();
    await page.waitForTimeout(700);
    check((await count(page)) === '3 / 3', `Design Studio: tap the card → 3 / 3 (${await count(page)})`);
    check(await page.getByTestId('first-run-tip-explainer-ok').first().isVisible(), 'Design Studio: Got it on the last card');
    await shot(page, '03-design-card3-got-it');
    await page.getByTestId('first-run-tip-explainer-ok').first().click();
    await page.waitForTimeout(400);
    check((await page.locator(sheet('explain-design-gallery')).count()) === 0, 'Design Studio: Got it closes it');

    await nav(page, activity, '/manufacturer-hub');
    check(await visible(page, sheet('explain-manufacturer-hub'), 12_000), 'Manufacturer Hub: explainer shows');
    await shot(page, '04-hub-card1');
    await page.getByTestId('first-run-tip-explainer-close').first().click();
    await page.waitForTimeout(400);
    check((await page.locator(sheet('explain-manufacturer-hub')).count()) === 0, 'Manufacturer Hub: X bails from card 1');

    await nav(page, activity, '/analytics');
    check(await visible(page, sheet('seller-analytics'), 12_000), 'Analytics: explainer shows');
    await page.getByTestId('first-run-tip-explainer-next').first().click();
    await page.waitForTimeout(700);
    check((await count(page)) === '2 / 3', `Analytics: Next → 2 / 3 (${await count(page)})`);
    await shot(page, '05-analytics-card2');
    await page.mouse.click(195, 60); // the scrim above the sheet
    await page.waitForTimeout(400);
    check((await page.locator(sheet('seller-analytics')).count()) === 0, 'Analytics: tap outside bails mid-carousel');

    for (const [id, route] of [['explain-design-gallery', '/design'], ['explain-manufacturer-hub', '/manufacturer-hub'], ['seller-analytics', '/analytics']]) {
      await nav(page, activity, '/products');
      await nav(page, activity, route);
      check(!(await visible(page, sheet(id), 4000)), `${route}: leave → return shows nothing`);
    }
    for (const [id, route] of [['explain-design-gallery', '/design'], ['explain-manufacturer-hub', '/manufacturer-hub'], ['seller-analytics', '/analytics']]) {
      await page.goto(`${origin}${route}?bt_preview=seller&tips=1`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 800, 15_000);
      if (new URL(page.url()).pathname !== route) await nav(page, activity, route);
      check(!(await visible(page, sheet(id), 5000)), `${route}: after a reload shows nothing`);
      if (route === '/design') await shot(page, '06-design-after-reload');
    }

    for (const [id, route] of KEPT_SELLER) {
      await nav(page, activity, route);
      const ok = await visible(page, sheet(id), 12_000);
      check(ok && (await count(page)) === '1 / 3', `kept ${route}: carousel shows at 1 / 3`);
      if (ok) {
        await shot(page, `07-kept${route.replace(/\//g, '-')}`);
        await page.getByTestId('first-run-tip-explainer-close').first().click();
        await page.waitForTimeout(400);
      }
    }
    await context.close();

    // Pruned seller screens, on a fresh account (nothing seen, nothing else up).
    ({ context, page, activity } = await open(browser, 'seller', origin, images));
    for (const route of PRUNED_SELLER) {
      const on = await nav(page, activity, route);
      const any = await visible(page, ANY_EXPLAINER, 3000);
      check(on && !any, `pruned ${route}: no explainer`);
    }
    await shot(page, '08-pruned-rfq-list');
    await context.close();

    // ── Buyer ──────────────────────────────────────────────────────────
    ({ context, page, activity } = await open(browser, 'buyer', origin, images));
    for (const [id, route] of KEPT_BUYER) {
      await nav(page, activity, route);
      const ok = await visible(page, sheet(id), 12_000);
      check(ok && (await count(page)) === '1 / 3', `kept ${route}: carousel shows at 1 / 3`);
      if (ok) {
        await shot(page, `09-kept${route.replace(/\//g, '-')}`);
        await page.getByTestId('first-run-tip-explainer-close').first().click();
        await page.waitForTimeout(400);
      }
    }
    await context.close();
    ({ context, page, activity } = await open(browser, 'buyer', origin, images));
    for (const route of PRUNED_BUYER) {
      const on = await nav(page, activity, route);
      const any = await visible(page, ANY_EXPLAINER, 3000);
      check(on && !any, `pruned ${route} (buyer): no explainer`);
    }
    await context.close();
  } finally {
    await browser.close();
    await close();
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
