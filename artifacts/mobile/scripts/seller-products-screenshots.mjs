#!/usr/bin/env node
/**
 * Seller screens wave — 390×844 screenshots of each touched seller screen in
 * a fresh account (`?bt_preview=seller`) and the demo dataset (`&demo=1`),
 * plus a text-fit audit. Point it at a web export (the harness's
 * buildPreviewWeb) so the same script captures "before" (dev) and "after".
 *
 *   node scripts/seller-products-screenshots.mjs --build=<dir> --out=<dir> [--only=a,b] [--modes=fresh,demo]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, serveBuild } from './store-screenshots/harness.mjs';
import { checkTextFit } from './store-screenshots/text-fit.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BUILD = path.resolve(arg('build') ?? '/var/tmp/bt-web-after');
const OUT = path.resolve(arg('out') ?? 'docs/pr-assets/seller-screens');
const ONLY = arg('only')?.split(',');
const MODES = (arg('modes') ?? 'fresh,demo').split(',');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** name → route (+ optional scroll to capture a lower part of the screen). */
const SCREENS = [
  { name: 'dashboard', route: '/' },
  { name: 'dashboard-scrolled', route: '/', scroll: 700 },
  { name: 'share-store', route: '/share-store' },
  // pushState to /products leaves the tab navigator on the dashboard — tap the tab.
  { name: 'products', route: '/', actions: async (page) => {
    await openProductsTab(page);
  } },
  { name: 'products-scrolled', route: '/', scroll: 420, actions: async (page) => {
    await openProductsTab(page);
  } },
  { name: 'products-low-stock', route: '/', actions: async (page) => {
    await openProductsTab(page);
    await page.getByText('Low Stock', { exact: true }).first().click();
    await page.waitForTimeout(800);
  } },
  { name: 'products-bulk-edit', route: '/products-bulk-edit' },
  // Bulk edit: select everything, open the Stock tab, then preview "Remove 4".
  { name: 'products-bulk-selected', route: '/products-bulk-edit', actions: async (page) => {
    await page.getByLabel('Select all displayed products', { exact: true }).click({ timeout: 8000 });
  } },
  { name: 'products-bulk-stock', route: '/products-bulk-edit', actions: async (page) => {
    await page.getByLabel('Select all displayed products', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Edit stock', { exact: true }).click({ timeout: 8000 });
  } },
  { name: 'products-bulk-stock-preview', route: '/products-bulk-edit', actions: async (page) => {
    await page.getByLabel('Select all displayed products', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Edit stock', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Remove', { exact: true }).click();
    await page.getByTestId('bulk-stock-input').fill('4');
    await page.waitForTimeout(600);
  } },
  { name: 'products-bulk-stock-preview-scrolled', route: '/products-bulk-edit', scroll: 600, actions: async (page) => {
    await page.getByLabel('Select all displayed products', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Edit stock', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Remove', { exact: true }).click();
    await page.getByTestId('bulk-stock-input').fill('4');
    await page.waitForTimeout(600);
  } },
  { name: 'products-bulk-stock-done', route: '/products-bulk-edit', actions: async (page) => {
    await page.getByLabel('Select all displayed products', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Edit stock', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Remove', { exact: true }).click();
    await page.getByTestId('bulk-stock-input').fill('4');
    await page.waitForTimeout(600);
    await page.getByLabel('Apply to 5 products', { exact: true }).click();
  } },
  { name: 'products-bulk-price-preview', route: '/products-bulk-edit', scroll: 500, actions: async (page) => {
    await page.getByLabel('Select all displayed products', { exact: true }).click({ timeout: 8000 });
    await page.getByLabel('Edit prices', { exact: true }).click({ timeout: 8000 });
    await page.getByPlaceholder('10', { exact: true }).fill('10');
    await page.waitForTimeout(600);
  } },
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
];

let issues = 0;

/** Tap the Products tab, then put the preview query back on the URL (tab presses drop it, and demo mode reads it). */
async function openProductsTab(page) {
  const extra = new URL(page.url()).search;
  await page.getByTestId('seller-tab-products').click();
  await page.waitForTimeout(1200);
  await page.evaluate((search) => {
    history.replaceState(history.state, '', `/products${search}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, extra);
  await page.waitForTimeout(2500);
}

async function capture(browser, origin, mode, screens) {
  // Interactive states each get a fresh browser context so earlier taps
  // (selection, tab switches) never leak into the next capture.
  const plain = screens.filter((sc) => !sc.actions);
  if (plain.length) await captureIn(browser, origin, mode, plain);
  for (const sc of screens.filter((x) => x.actions)) await captureIn(browser, origin, mode, [sc]);
}

async function captureIn(browser, origin, mode, screens) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (e) => console.log(`  [pageerror ${mode}]`, e.message.slice(0, 160)));
  const extra = mode === 'demo' ? '&demo=1' : '';
  await openScreen(page, activity, origin, 'seller', '/', { extraQuery: extra });
  await page.waitForTimeout(4000);
  for (const screen of screens) {
    const url = `${screen.route}${screen.route.includes('?') ? '&' : '?'}bt_preview=seller${extra}`;
    await page.evaluate((target) => {
      history.pushState(history.state, '', target);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, url);
    await page.waitForTimeout(3500);
    if (screen.actions) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await screen.actions(page);
          await page.waitForTimeout(1200);
          break;
        } catch (e) {
          console.log(`  [actions ${screen.name} ${mode} #${attempt}]`, String(e.message).split('\n')[0].slice(0, 160));
          // Navigation sometimes lands late: reload the route and try again.
          await page.goto(`${origin}${url}`);
          await page.waitForTimeout(5000);
        }
      }
    }
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
