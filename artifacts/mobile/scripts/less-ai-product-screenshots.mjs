#!/usr/bin/env node
/**
 * "Less AI" product page pass (items 21–32): buyer product detail on the
 * store-screenshots harness (signed-in demo buyer, fake API), served from a
 * prebuilt web export.
 *
 *   node scripts/less-ai-product-screenshots.mjs <buildDir> <prefix> [WxH ...]
 *
 * For each viewport captures: 01-top, 02-size-selected, 03-scrolled (solid
 * top bar), 04-seller-rows, 05-reviews, 06-more-from-brand. Prints a few
 * measurements (photo height, chip/CTA sizes, dots) as JSON.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = process.argv[2];
const PREFIX = process.argv[3] ?? 'after';
const SIZES = (process.argv.slice(4).length ? process.argv.slice(4) : ['390x844']).map((s) => {
  const [width, height] = s.split('x').map(Number);
  return { width, height };
});
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/less-ai-product');
mkdirSync(OUT, { recursive: true });
const PRODUCT = 'prod_nl_hoodie_ember';
const API = 'https://api.brandthread.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function scrollTo(page, y) {
  await page.evaluate((top) => {
    const candidates = [...document.querySelectorAll('div')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
    });
    const main = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (main) { main.scrollTop = top; main.dispatchEvent(new Event('scroll')); }
  }, y);
  await page.waitForTimeout(700);
}

async function scrollToTestId(page, testId, offset = 120) {
  return page.evaluate(({ id, off }) => {
    const target = document.querySelector(`[data-testid="${id}"]`);
    if (!target) return false;
    const candidates = [...document.querySelectorAll('div')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
    });
    const main = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!main) return false;
    main.scrollTop += target.getBoundingClientRect().top - off;
    main.dispatchEvent(new Event('scroll'));
    return true;
  }, { id: testId, off: offset });
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const report = {};
  for (const viewport of SIZES) {
    const tag = `${viewport.width}x${viewport.height}`;
    const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
    await context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      if (/payment-status/.test(p)) {
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' }, contentType: 'application/json', body: '{"ready":true}' });
      }
      return route.fallback();
    });
    page.setDefaultNavigationTimeout(240_000);
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));
    await openScreen(page, activity, server.origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await page.getByText('Heavyweight Hoodie — Ember').first().waitFor({ timeout: 12_000 });
        break;
      } catch (error) {
        if (attempt === 4) { await page.screenshot({ path: path.join(OUT, `debug-${PREFIX}-${tag}.png`) }); throw error; }
        await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, `/buyer-product-detail?productId=${PRODUCT}&bt_preview=buyer`);
      }
    }
    await waitForQuietNetwork(activity, 900, 20_000);
    await waitForImages(page);
    await page.waitForTimeout(1500);
    const shot = async (name) => {
      await page.waitForTimeout(300);
      const file = `${PREFIX}-${tag}-${name}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      console.log(`  ✓ ${file}`);
    };
    await shot('01-top');

    const size = page.locator('[data-testid="option-opt_size-size_M"]').first();
    await size.scrollIntoViewIfNeeded().catch(() => {});
    await size.click();
    await page.waitForTimeout(600);
    await shot('02-size-selected');

    report[tag] = await page.evaluate(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };
      const chip = document.querySelector('[data-testid="option-opt_size-size_M"]');
      return {
        sizeChip: box(chip),
        sizeChipBg: chip ? getComputedStyle(chip).backgroundColor : null,
        addToBag: box(document.querySelector('[data-testid="product-add-to-cart"]')),
        addToBagText: document.querySelector('[data-testid="product-add-to-cart"]')?.innerText ?? null,
        save: box(document.querySelector('[data-testid="product-save-heart"]')),
        share: box(document.querySelector('[data-testid="product-share-bar"]')),
        brand: document.querySelector('[data-testid="product-brand-link"]')?.innerText ?? null,
      };
    });

    await scrollTo(page, 0);
    await scrollTo(page, Math.round(viewport.height * 0.65));
    await shot('03-scrolled');
    report[tag].topBarTitle = await page.evaluate(() => document.querySelector('[data-testid="product-top-bar-title"]')?.innerText ?? null);

    if (await scrollToTestId(page, 'product-seller-link', 140)) { await page.waitForTimeout(600); await shot('04-seller-rows'); }
    const details = page.locator('[data-testid="product-row-details"]').first();
    if (await details.count()) {
      await details.click();
      await page.locator('[data-testid="product-row-returns"]').first().click().catch(() => {});
      await page.waitForTimeout(600);
      await scrollToTestId(page, 'product-info-rows', 140);
      await page.waitForTimeout(600);
      await shot('04b-rows-expanded');
    }
    if (await scrollToTestId(page, 'product-reviews-average-row', 160) || await page.getByText(/^Reviews \(/).first().scrollIntoViewIfNeeded().then(() => true).catch(() => false)) {
      await page.waitForTimeout(600); await shot('05-reviews');
    }
    const more = await scrollToTestId(page, 'product-more-from-brand', 300)
      || await page.getByText('You might also like').first().scrollIntoViewIfNeeded().then(() => true).catch(() => false);
    if (more) { await page.waitForTimeout(800); await waitForImages(page); await shot('06-more-from-brand'); }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
