#!/usr/bin/env node
/**
 * Seller screens wave — 390×844 screenshots of each touched seller screen in
 * a fresh account (`?bt_preview=seller`) and the demo dataset (`&demo=1`),
 * plus a text-fit audit. Point it at a web export (the harness's
 * buildPreviewWeb) so the same script captures "before" (dev) and "after".
 *
 *   node scripts/seller-orders-screenshots.mjs --build=<dir> --out=<dir> [--only=a,b] [--modes=fresh,demo]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, serveBuild } from './store-screenshots/harness.mjs';
import { checkTextFit } from './store-screenshots/text-fit.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BUILD = path.resolve(arg('build') ?? '/var/tmp/bt-web-after');
const OUT = path.resolve(arg('out') ?? 'docs/pr-assets/seller-orders');
const ONLY = arg('only')?.split(',');
const MODES = (arg('modes') ?? 'fresh,demo').split(',');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** name → route (+ optional scroll to capture a lower part of the screen). */
const SCREENS = [
  { name: 'dashboard', route: '/' },
  { name: 'dashboard-scrolled', route: '/', scroll: 700 },
  { name: 'share-store', route: '/share-store' },
  { name: 'products', route: '/products' },
  { name: 'products-bulk-edit', route: '/products-bulk-edit' },
  { name: 'orders', route: '/orders' },
  { name: 'order-detail', route: '/order-detail?id=ord_1046' },
  { name: 'fulfill-batch', route: '/fulfill-batch?orderIds=ord_1048,ord_1047' },
  { name: 'payouts', route: '/payouts' },
  { name: 'add-product', route: '/add-product' },
  { name: 'seller-go-live', route: '/seller-go-live' },
  { name: 'customers', route: '/customers' },
  { name: 'discounts', route: '/discounts' },
  { name: 'billing', route: '/billing' },
  { name: 'subscription', route: '/subscription' },
  { name: 'notifications-settings', route: '/notifications-settings' },
  { name: 'seller-settings', route: '/seller-settings' },
  // Order fulfilment flow (Shopify "Marking order as fulfilled"), demo orders only.
  { name: 'batch-sheet', route: '/fulfill-batch?orderIds=preview-demo-order-20713-4,preview-demo-order-20713-1,preview-demo-order-20713-2', modes: ['demo'], steps: [{ click: 'batch-fulfill' }] },
  { name: 'order-unfulfilled', route: '/order-detail?id=preview-demo-order-20713-4', modes: ['demo'] },
  { name: 'fulfill-sheet', route: '/order-detail?id=preview-demo-order-20713-4', modes: ['demo'], steps: [
    { click: 'order-fulfill-item' }, { fill: ['fulfill-tracking-number', '1Z999AA10123456784'] },
    { click: 'fulfill-carrier' }, { click: 'fulfill-carrier-sheet-UPS' },
  ] },
  { name: 'fulfill-completed', route: '/order-detail?id=preview-demo-order-20713-4', modes: ['demo'], steps: [
    { click: 'order-fulfill-item' }, { fill: ['fulfill-tracking-number', '1Z999AA10123456784'] },
    { click: 'fulfill-carrier' }, { click: 'fulfill-carrier-sheet-UPS' }, { click: 'fulfill-sheet-confirm', wait: 1500 },
  ] },
  { name: 'order-fulfilled', route: '/order-detail?id=preview-demo-order-20711-1', modes: ['demo'] },
  { name: 'fulfilled-after', route: '/order-detail?id=preview-demo-order-20713-4', modes: ['demo'], steps: [
    { click: 'order-fulfill-item' }, { fill: ['fulfill-tracking-number', '1Z999AA10123456784'] },
    { click: 'fulfill-carrier' }, { click: 'fulfill-carrier-sheet-UPS' }, { click: 'fulfill-sheet-confirm', wait: 1500 },
    { scrollTo: 'order-fulfilled-block' },
  ] },
  { name: 'orders-tab', route: '/', tab: 'seller-tab-orders' },
  { name: 'refund-sheet', route: '/order-detail?id=preview-demo-order-20713-7', modes: ['demo'], steps: [
    { click: 'order-refund' }, { fill: ['refund-amount', '40.00'] }, { click: 'refund-reason' }, { click: 'refund-reason-sheet-price_adjustment' },
  ] },
  { name: 'refund-done', route: '/order-detail?id=preview-demo-order-20713-7', modes: ['demo'], steps: [
    { click: 'order-refund' }, { fill: ['refund-amount', '40.00'] }, { click: 'refund-reason' }, { click: 'refund-reason-sheet-price_adjustment' },
    { click: 'refund-sheet-confirm', wait: 1500 }, { scrollTo: 'order-paid-block' },
  ] },
  { name: 'order-two-items', route: '/order-detail?id=preview-demo-order-20713-0', modes: ['demo'] },
  { name: 'order-two-items-sheet', route: '/order-detail?id=preview-demo-order-20713-0', modes: ['demo'], steps: [{ click: 'order-fulfill-item' }] },
];

async function go(page, url) {
  await page.evaluate((target) => {
    history.pushState(history.state, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, url);
}

async function runSteps(page, steps = []) {
  for (const step of steps) {
    if (step.click) await page.locator(`[data-testid="${step.click}"]`).last().click({ timeout: 8000 });
    if (step.fill) await page.locator(`[data-testid="${step.fill[0]}"]`).last().fill(step.fill[1], { timeout: 8000 });
    if (step.scrollTo) await page.locator(`[data-testid="${step.scrollTo}"]`).last().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(step.wait ?? 900);
  }
}

let issues = 0;

async function capture(browser, origin, mode, screens) {
  const plain = screens.filter((sc) => !sc.modes && !sc.tab);
  if (plain.length) await captureIn(browser, origin, mode, plain);
  for (const sc of screens.filter((x) => x.modes || x.tab)) {
    if (sc.modes && !sc.modes.includes(mode)) continue;
    await captureIn(browser, origin, mode, [sc]);
  }
}

async function captureIn(browser, origin, mode, screens) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (e) => console.log(`  [pageerror ${mode}]`, e.message.slice(0, 160)));
  const extra = mode === 'demo' ? '&demo=1' : '';
  await openScreen(page, activity, origin, 'seller', '/', { extraQuery: extra });
  await page.waitForTimeout(4000);
  for (const screen of screens) {
    const withQuery = (route) => `${route}${route.includes('?') ? '&' : '?'}bt_preview=seller${extra}`;
    await go(page, withQuery(screen.route));
    await page.waitForTimeout(3500);
    // The first client-side push from the dashboard is occasionally dropped; push again.
    if (screen.route.startsWith('/order-detail') && !(await page.locator('[data-testid="order-paid-block"]').count())) {
      await go(page, withQuery(screen.route));
      await page.waitForTimeout(3500);
    }
    if (screen.tab) {
      // Tab presses drop the preview query; put it back (demo mode reads it).
      const search = new URL(page.url()).search;
      await page.getByTestId(screen.tab).first().click();
      await page.waitForTimeout(1200);
      await page.evaluate((q) => {
        history.replaceState(history.state, '', `${location.pathname}${q}`);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, search);
      await page.waitForTimeout(2500);
    }
    try { await runSteps(page, screen.steps); } catch (e) { console.log(`  [steps ${screen.name}]`, String(e).slice(0, 200)); }
    if (screen.scroll) {
      await page.evaluate((y) => document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 200) el.scrollTop = y;
      }), screen.scroll);
      await page.waitForTimeout(600);
    }
    const file = path.join(OUT, `${screen.name}-${mode}.png`);
    await page.screenshot({ path: file });
    const fit = await checkTextFit(page).catch(() => []);
    if (fit.length) {
      issues += fit.length;
      console.log(`${screen.name} (${mode}): ${fit.length} text-fit issue(s)`);
      for (const i of fit.slice(0, 6)) console.log('   ', JSON.stringify(i));
    } else {
      console.log(`${screen.name} (${mode}): ok`);
    }
  }
  await context.close();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const screens = ONLY ? SCREENS.filter((s) => ONLY.includes(s.name)) : SCREENS;
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  try {
    for (const mode of MODES) await capture(browser, origin, mode, screens);
  } finally {
    await browser.close();
    close();
  }
  console.log(issues ? `\n${issues} text-fit issue(s)` : '\ntext-fit clean');
}
run().catch((e) => { console.error(e); process.exit(1); });
