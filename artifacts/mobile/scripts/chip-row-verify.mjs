#!/usr/bin/env node
/**
 * ChipRow verification: for each screen with a top-of-screen chip row, finds
 * the row, swipes it to the end, checks the last chip is fully on screen with
 * the 16pt trailing inset, taps the last chip, and saves crops of each step.
 *
 *   node scripts/chip-row-verify.mjs --out dir [--build-dir path] [--width 375]
 *
 * Uses the same demo web build + fake Clerk/API harness as the other
 * screenshot scripts (see scripts/store-screenshots/harness.mjs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const out = path.resolve(val('--out', path.join(MOBILE_ROOT, 'scratch', 'chip-rows')));
const buildDir = path.resolve(val('--build-dir', DEFAULT_BUILD_DIR));
const width = Number(val('--width', '375'));
const only = val('--only', null)?.split(',');

export const SCREENS = [
  { id: 'seller-orders', role: 'seller', path: '/orders' },
  { id: 'seller-products', role: 'seller', path: '/products' },
  { id: 'seller-activity', role: 'seller', path: '/seller-activity' },
  { id: 'activity', role: 'buyer', path: '/activity-center' },
  { id: 'notifications', role: 'buyer', path: '/buyer-notifications' },
  { id: 'buyer-orders', role: 'buyer', path: '/orders' },
  { id: 'discover', role: 'buyer', path: '/discover' },
  { id: 'search-tabs', role: 'buyer', path: '/buyer-search?q=hoodie' },
  { id: 'thread-cash-ledger', role: 'buyer', path: '/thread-cash-ledger' },
  { id: 'product-reviews', role: 'seller', path: '/product-reviews' },
  { id: 'store-editor', role: 'seller', path: '/store-editor' },
  { id: 'store-ai-improve', role: 'seller', path: '/store-ai-improve' },
  { id: 'manufacturer-hub', role: 'seller', path: '/manufacturer-hub' },
  { id: 'admin-reports', role: 'seller', path: '/admin-reports' },
  { id: 'content', role: 'seller', path: '/content' },
  { id: 'product-detail', role: 'seller', path: '/product-detail?id=prod_nl_jacket_rust' },
  { id: 'analytics-sales', role: 'seller', path: '/analytics-sales' },
  { id: 'analytics-products', role: 'seller', path: '/analytics-products' },
];

/** In page: the top-most horizontal scroller that holds 3+ tappable chips. */
function findRow() {
  const rows = [...document.querySelectorAll('div')].filter((el) => {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowX)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 20 || r.height > 400 || r.top < 0 || r.top > window.innerHeight * 0.8) return false;
    // ignore rows on stack screens hidden behind the current one
    for (let a = el; a; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0') return false;
    }
    return el.querySelectorAll('[role="button"], [role="tab"], button').length >= 3;
  }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const row = rows[0];
  if (!row) return null;
  row.setAttribute('data-chiprow-under-test', '1');
  const chips = [...row.querySelectorAll('[role="button"], [role="tab"], button')].filter((c) => !c.parentElement.closest('[role="button"], [role="tab"], button'));
  chips.forEach((c, i) => c.setAttribute('data-chip-index', String(i)));
  const r = row.getBoundingClientRect();
  return { top: r.top, height: r.height, left: r.left, width: r.width, chips: chips.length, scrollable: row.scrollWidth > row.clientWidth + 1 };
}

function measureLast() {
  const row = document.querySelector('[data-chiprow-under-test]');
  const chips = row.querySelectorAll('[data-chip-index]');
  const last = chips[chips.length - 1].getBoundingClientRect();
  const first = chips[0].getBoundingClientRect();
  return {
    scrollLeft: Math.round(row.scrollLeft),
    maxScroll: row.scrollWidth - row.clientWidth,
    lastRight: Math.round(last.right),
    firstLeft: Math.round(first.left),
    trailingGap: Math.round(window.innerWidth - last.right),
    lastFullyVisible: last.left >= 0 && last.right <= window.innerWidth,
  };
}

async function main() {
  mkdirSync(out, { recursive: true });
  const { origin, close } = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));
  const device = { viewport: { width, height: 812 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' };
  const report = [];
  try {
    for (const screen of SCREENS.filter((s) => !only || only.includes(s.id))) {
      const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
      try {
        const want = screen.path.split('?')[0].replace(/\/\([^)]*\)/g, '') || '/';
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await openScreen(page, activity, origin, screen.role, screen.path, { extraQuery: '&demo=1' });
          await page.waitForTimeout(2000 + attempt * 1500);
          if (new URL(page.url()).pathname.replace(/\/\([^)]*\)/g, '') === want) break;
        }
        await waitForQuietNetwork(activity, 600, 8000);
        await waitForImages(page, 4000);
        const row = await page.evaluate(findRow);
        if (!row) {
          const landed = new URL(page.url()).pathname;
          report.push({ id: screen.id, error: `no chip row found (landed ${landed})` });
          await page.screenshot({ path: path.join(out, `${screen.id}-0-no-row.png`) });
          console.log(`--   ${screen.id}: no chip row found (landed ${landed})`);
          continue;
        }
        const clip = { x: 0, y: Math.max(0, row.top - 12), width, height: row.height + 24 };
        await page.screenshot({ path: path.join(out, `${screen.id}-1-rest.png`), clip });
        const start = await page.evaluate(measureLast);
        // swipe to the end (what a finger fling does)
        await page.evaluate(() => { const r = document.querySelector('[data-chiprow-under-test]'); r.scrollLeft = r.scrollWidth; });
        await page.waitForTimeout(500);
        const end = await page.evaluate(measureLast);
        await page.screenshot({ path: path.join(out, `${screen.id}-2-swiped-to-end.png`), clip });
        // back to start, then tap the last chip
        await page.evaluate(() => { const r = document.querySelector('[data-chiprow-under-test]'); r.scrollLeft = 0; });
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          const chips = document.querySelectorAll('[data-chiprow-under-test] [data-chip-index]');
          chips[chips.length - 1].click();
        });
        await page.waitForTimeout(900);
        const tapped = await page.evaluate(() => {
          const row = document.querySelector('[data-chiprow-under-test]');
          if (!row) return null;
          const chips = row.querySelectorAll('[data-chip-index]');
          const r = chips[chips.length - 1].getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), fullyVisible: r.left >= 0 && r.right <= window.innerWidth };
        });
        await page.screenshot({ path: path.join(out, `${screen.id}-3-tapped-last.png`), clip });
        report.push({ id: screen.id, chips: row.chips, scrollable: row.scrollable, start, end, tapped });
        console.log(`${end.lastFullyVisible && end.trailingGap >= 15 ? 'ok  ' : 'FAIL'} ${screen.id}: ${row.chips} chips, start firstLeft=${start.firstLeft}, end trailing gap=${end.trailingGap}, tapped-last visible=${tapped?.fullyVisible}`);
      } catch (e) {
        report.push({ id: screen.id, error: String(e.message).split('\n')[0] });
        console.log(`ERR  ${screen.id}: ${String(e.message).split('\n')[0]}`);
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    close();
  }
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
