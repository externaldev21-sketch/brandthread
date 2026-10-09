#!/usr/bin/env node
/**
 * Seller screens wave — 390×844 screenshots of each touched seller screen in
 * a fresh account (`?bt_preview=seller`) and the demo dataset (`&demo=1`),
 * plus a text-fit audit. Point it at a web export (the harness's
 * buildPreviewWeb) so the same script captures "before" (dev) and "after".
 *
 *   node scripts/seller-screens-screenshots.mjs --build=<dir> --out=<dir> [--only=a,b] [--modes=fresh,demo]
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
  // Customers wave: sheets / detail opened by clicking on the page.
  { name: 'customers-sort', route: '/customers', click: '[data-testid="customers-sort"]' },
  { name: 'customer-detail', route: '/customers', click: '[data-testid="customer-row"]' },
  { name: 'discounts-actions', route: '/discounts', click: '[data-testid="discount-row"]' },
  { name: 'discounts-scheduled', route: '/discounts', click: '[data-testid="discounts-filter-scheduled"]' },
  { name: 'seller-settings-notifications-row', route: '/seller-settings', scrollToText: 'Notifications' },
  { name: 'seller-settings-notifications', route: '/seller-settings', clickText: 'Notifications' },
];

let issues = 0;

async function capture(browser, origin, mode, screens) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (e) => console.log(`  [pageerror ${mode}]`, e.message.slice(0, 160)));
  const extra = mode === 'demo' ? '&demo=1' : '';
  for (const screen of screens) {
    // A fresh load per screen: chained client-side pushes sometimes bounced
    // back to the dashboard in the harness.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openScreen(page, activity, origin, 'seller', screen.route, { extraQuery: extra });
      await page.waitForTimeout(3500);
      // Retry when the harness bounced a pushed route back to the dashboard.
      const bounced = screen.route !== '/' && (await page.getByText('Dashboard', { exact: true }).count()) > 0;
      if (!bounced) break;
      console.log(`  [retry ${screen.name}] bounced to the dashboard (${mode})`);
    }
    if (screen.scrollToText) {
      await page.getByText(screen.scrollToText, { exact: true }).last().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
    }
    if (screen.click || screen.clickText) {
      const target = screen.click ? page.locator(screen.click).first() : page.getByText(screen.clickText, { exact: true }).last();
      if (await target.count()) {
        await target.click().catch((e) => console.log(`  [click ${screen.name}]`, e.message.slice(0, 120)));
        await page.waitForTimeout(1800);
      } else {
        console.log(`  [click ${screen.name}] target not found (${mode})`);
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
