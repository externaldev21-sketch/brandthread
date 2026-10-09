#!/usr/bin/env node
/**
 * 393x852 screenshots for the size chart templates PR. Uses the preview web
 * export with a stateful fake for /api/size-chart-templates layered over the
 * shared demo API.
 *
 *   node scripts/size-chart-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';
import { reportTextFit } from './lib/textFitCheck.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/size-chart-templates');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const API = 'https://api.brandthread.test';

const PRESETS = [
  { key: 'tops', name: 'Tops & tees', chart: { unit: 'inches', columns: ['Chest', 'Length', 'Sleeve'], rows: [['XS', '32-34', '25', '7.5'], ['S', '35-37', '26', '8'], ['M', '38-40', '27', '8.5'], ['L', '41-43', '28', '9'], ['XL', '44-46', '29', '9.5']].map(([size, ...values]) => ({ size, values })) } },
  { key: 'bottoms', name: 'Pants & shorts', chart: { unit: 'inches', columns: ['Waist', 'Hip', 'Inseam'], rows: [['S', '29-31', '37-39', '30'], ['M', '32-34', '40-42', '31'], ['L', '35-37', '43-45', '31']].map(([size, ...values]) => ({ size, values })) } },
  { key: 'dresses', name: 'Dresses', chart: { unit: 'inches', columns: ['Bust', 'Waist', 'Hip', 'Length'], rows: [['S', '34', '27', '37', '39'], ['M', '36', '29', '39', '40']].map(([size, ...values]) => ({ size, values })) } },
  { key: 'hats', name: 'Hats & beanies', chart: { unit: 'inches', columns: ['Head circumference'], rows: [{ size: 'S/M', values: ['21-22'] }, { size: 'L/XL', values: ['22.5-24'] }] } },
];
const templates = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Heavyweight hoodies', chart: { unit: 'cm', columns: ['Chest', 'Length', 'Sleeve'], rows: [['XS', '81-86', '63.5', '19'], ['S', '89-94', '66', '20.5'], ['M', '96.5-101.5', '68.5', '21.5'], ['L', '104-109', '71', '23'], ['XL', '112-117', '73.5', '24']].map(([size, ...values]) => ({ size, values })) }, updatedAt: '2026-09-01T00:00:00Z', productCount: 3, products: [] }];

async function fake(context, origin) {
  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  await context.route(/api\.brandthread\.test\/api\/(v1\/)?size-chart-templates/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = new URL(req.url()).pathname.replace(/^\/api(\/v1)?\/size-chart-templates/, "");
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET' && p === '') return json({ templates, presets: PRESETS });
    if (req.method() === 'GET') return json({ ...templates[0], products: [{ id: 'prod_nl_hoodie_ember', name: 'Heavyweight Hoodie — Ember', images: [] }] });
    return json({ ok: true, id: templates[0].id, applied: 1, synced: 1 });
  });
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    await fake(context, origin);
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    await openScreen(page, activity, origin, 'seller', '/size-chart-templates', {
      beforeNavigate: async () => { await page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')); },
    });
    const go = (url) => page.evaluate((u) => {
      history.pushState(history.state, '', u);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, url);
    const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('  ✓', name); await reportTextFit(page, name, { strict: false }); };
    const visit = async (url, text, name) => {
      for (let i = 0; i < 5; i += 1) {
        await go(url);
        await page.waitForTimeout(2500);
        if (await page.getByText(text).first().isVisible().catch(() => false)) break;
      }
      await shot(name);
    };
    await page.waitForTimeout(5000);
    await visit('/size-chart-templates?bt_preview=seller', 'Start from a preset', '01-list');
    await page.screenshot({ path: path.join(OUT, 'zoom-01-chart-rows.png'), clip: { x: 0, y: 130, width: 393, height: 410 } });
    await visit('/size-chart-template-edit?id=11111111-1111-4111-8111-111111111111&bt_preview=seller', 'Edit size chart', '02-edit-saved-cm');
    await visit('/size-chart-template-edit?preset=dresses&bt_preview=seller', 'New size chart', '03-new-from-preset');
    await page.screenshot({ path: path.join(OUT, 'zoom-03-unit-and-measurement-chips.png'), clip: { x: 0, y: 120, width: 393, height: 260 } });
    await visit('/size-chart-template-apply?id=11111111-1111-4111-8111-111111111111&bt_preview=seller', 'Apply to products', '04-apply-to-products');
    await visit('/product-size-chart?productId=prod_nl_hoodie_ember&bt_preview=seller', 'Use a saved size chart', '05-product-size-chart-entry');
    await visit('/size-chart-templates?productId=prod_nl_hoodie_ember&bt_preview=seller', 'Your charts', '06-pick-mode');
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
