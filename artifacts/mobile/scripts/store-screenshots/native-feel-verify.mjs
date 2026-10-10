#!/usr/bin/env node
/**
 * Captures the native-feel menus/sheets/swipes at 390x844 on the web preview:
 * ⋯ pull-down menus, long-press preview menus, detent sheets, swipe rows.
 *
 *   node scripts/store-screenshots/native-feel-verify.mjs [outDir] [--demo] [--only=name,name]
 *
 * Expects a preview build in .store-screenshots/web-build (harness.mjs
 * `buildPreviewWeb`).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(MOBILE_ROOT, 'docs/pr-review/native-feel'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const suffix = demo ? '-demo' : '';

async function clickLabel(page, label) {
  await page.getByLabel(label, { exact: false }).first().click();
}

// Tab bar icon centres at 390x844 (seller: grid · analytics · products ·
// orders · profile; buyer: home · discover · inbox · activity · profile).
const SELLER_TABS = { products: 168, orders: 221, profile: 274 };
const BUYER_TABS = { home: 74, discover: 132, inbox: 190, activity: 248, profile: 311 };
async function tapTab(page, x) {
  await page.mouse.click(x, 791);
  await page.waitForTimeout(2200);
}
async function openSellerTab(page, name) {
  const key = Object.keys(SELLER_TABS).find((k) => name.test(k));
  await tapTab(page, SELLER_TABS[key]);
}
async function openBuyerTab(page, key) {
  await tapTab(page, BUYER_TABS[key]);
}

async function longPress(page, locator, ms = 700) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('long-press target not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

// Real touch events (the page emulates a phone, so RN-web's responder
// system listens for touches, not mouse moves).
async function touch(page, type, x, y) {
  const cdp = page.__cdp ?? (page.__cdp = await page.context().newCDPSession(page));
  await cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
}

async function swipeLeft(page, locator, distance = 160, { hold = false } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('swipe target not visible');
  const y = box.y + box.height / 2;
  const x = Math.min(box.x + box.width - 30, 360);
  await touch(page, 'touchStart', x, y);
  for (let i = 1; i <= 14; i++) {
    await touch(page, 'touchMove', x - (distance * i) / 14, y);
    await page.waitForTimeout(16);
  }
  if (hold) return; // screenshot mid-gesture (armed full swipe)
  await touch(page, 'touchEnd', x - distance, y);
}

async function swipeRight(page, locator, distance = 160) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('swipe target not visible');
  const y = box.y + box.height / 2;
  const x = Math.max(box.x + 40, 60);
  await touch(page, 'touchStart', x, y);
  for (let i = 1; i <= 14; i++) {
    await touch(page, 'touchMove', x + (distance * i) / 14, y);
    await page.waitForTimeout(16);
  }
  await touch(page, 'touchEnd', x + distance, y);
}

// Coordinates are CSS px at 390x844 (screenshots are 2x).
async function swipeAt(page, x, y, dx, { hold = false } = {}) {
  await touch(page, 'touchStart', x, y);
  for (let i = 1; i <= 14; i++) {
    await touch(page, 'touchMove', x + (dx * i) / 14, y);
    await page.waitForTimeout(16);
  }
  if (!hold) await touch(page, 'touchEnd', x + dx, y);
}
async function tapAt(page, x, y, wait = 2200) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(wait);
}

// A9 large titles: scroll the screen's list by `dy` CSS px with the wheel
// (RN-web lists are plain overflow:auto views), then let the frame settle.
async function scrollList(page, dy, x = 195, y = 560) {
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(600);
}
async function openBuyerMenu(page) {
  await openBuyerTab(page, 'profile');
  await page.getByLabel('More options', { exact: true }).first().click();
  await page.waitForTimeout(2200);
}
async function openBuyerSettings(page) {
  await openBuyerMenu(page);
  await page.getByLabel('Settings', { exact: true }).first().click();
  await page.waitForTimeout(2200);
}
async function openBuyerPrivacy(page) {
  await openBuyerSettings(page);
  await page.getByLabel(/^Privacy & activity/).first().click();
  await page.waitForTimeout(2500);
}
async function openSellerSettings(page) {
  await openSellerTab(page, /profile/);
  await page.getByLabel('Seller settings', { exact: true }).first().click();
  await page.waitForTimeout(2200);
}

export const FLOWS = [
  // ⋯ pull-down menus (Apple HIG pull-down button / UIMenu)
  { name: 'orders-pulldown', role: 'seller', act: async (p) => { await openSellerTab(p, /orders/i); await clickLabel(p, 'More order actions'); }, wait: 'pulldown-menu' },
  { name: 'products-pulldown', role: 'seller', act: async (p) => { await openSellerTab(p, /products/i); await p.getByLabel(/^more/i).first().click(); }, wait: 'pulldown-menu' },
  { name: 'seller-profile-pulldown', role: 'seller', act: async (p) => { await openSellerTab(p, /profile/); await p.getByTestId('seller-profile-more').first().click(); }, wait: 'pulldown-menu' },
  { name: 'buyer-profile-pulldown', role: 'buyer', act: async (p) => { await openBuyerTab(p, 'profile'); await p.getByTestId('buyer-profile-more').first().click(); }, wait: 'pulldown-menu' },
  // Long-press preview menus (Instagram grid long-press)
  { name: 'discover-longpress', role: 'buyer', act: async (p, h) => { await openBuyerTab(p, 'discover'); await h.longPress(p, p.locator('[data-testid^="discover-tile-"]').nth(1)); }, wait: 'context-menu-preview' },
  { name: 'discover-photo-longpress', role: 'buyer', act: async (p, h) => { await openBuyerTab(p, 'discover'); await h.longPress(p, p.locator('[data-testid^="discover-tile-"]').nth(0)); }, wait: 'context-menu-preview' },
  { name: 'buyer-orders-longpress', role: 'buyer', act: async (p, h) => { await openBuyerTab(p, 'profile'); await tapAt(p, 351, 532); await h.longPress(p, p.getByText(/^BT-|Order #/).first()); }, wait: 'context-menu-preview' },
  // Sheets with detents (Apple Maps / Instagram comments)
  { name: 'search-filters-half', role: 'buyer', act: async (p) => { await tapAt(p, 362, 81); await p.getByLabel(/filter/i).first().click(); await p.waitForTimeout(900); }, wait: null },
  // Swipe actions (Apple Mail)
  { name: 'orders-swipe', role: 'seller', act: async (p) => { await openSellerTab(p, /orders/i); await swipeAt(p, 330, 340, -140); }, wait: null },
  { name: 'orders-fullswipe', role: 'seller', act: async (p) => { await openSellerTab(p, /orders/i); await swipeAt(p, 340, 340, -270, { hold: true }); }, wait: null },
  { name: 'cart-swipe', role: 'buyer', act: async (p) => { await tapAt(p, 66, 80, 3000); await swipeAt(p, 340, 265, -170); }, wait: null },
  { name: 'notifications-swipe', role: 'buyer', act: async (p) => { await openBuyerTab(p, 'profile'); await tapAt(p, 282, 87, 3000); await swipeAt(p, 330, 260, -120); }, wait: null },
  // A9 large titles collapsing into the bar on scroll (iOS Settings / Mail):
  // -rest must look identical to before; -scrolled shows the compact title.
  { name: 'a9-menu-rest', role: 'buyer', act: async (p) => { await openBuyerMenu(p); }, wait: null },
  { name: 'a9-menu-mid', role: 'buyer', act: async (p) => { await openBuyerMenu(p); await scrollList(p, 12); }, wait: null },
  { name: 'a9-menu-scrolled', role: 'buyer', act: async (p) => { await openBuyerMenu(p); await scrollList(p, 160); }, wait: null },
  { name: 'a9-buyer-settings-rest', role: 'buyer', act: async (p) => { await openBuyerSettings(p); }, wait: null },
  { name: 'a9-buyer-settings-scrolled', role: 'buyer', act: async (p) => { await openBuyerSettings(p); await scrollList(p, 160); }, wait: null },
  { name: 'a9-privacy-rest', role: 'buyer', act: async (p) => { await openBuyerPrivacy(p); }, wait: null },
  { name: 'a9-privacy-scrolled', role: 'buyer', act: async (p) => { await openBuyerPrivacy(p); await scrollList(p, 160); }, wait: null },
  { name: 'a9-seller-settings-rest', role: 'seller', act: async (p) => { await openSellerSettings(p); }, wait: null },
  { name: 'a9-seller-settings-scrolled', role: 'seller', act: async (p) => { await openSellerSettings(p); await scrollList(p, 160); }, wait: null },
  // A11 native date/time pickers. The web preview shows the web fallback
  // (a native <input type="date">), not the iOS compact button.
  { name: 'a11-discount-dates', role: 'seller', act: async (p) => {
    await openSellerSettings(p);
    await p.getByLabel('Discounts', { exact: true }).first().click(); await p.waitForTimeout(2500);
    await p.getByLabel('New discount', { exact: true }).first().click(); await p.waitForTimeout(1500);
    await p.getByText('Active dates', { exact: true }).last().scrollIntoViewIfNeeded();
    await p.getByRole('switch').last().click(); await p.waitForTimeout(500);
    await p.getByText('Active dates', { exact: true }).last().scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  }, wait: null },
  { name: 'a11-vacation', role: 'seller', act: async (p) => {
    await openSellerSettings(p);
    await p.getByLabel('Vacation mode', { exact: true }).first().click(); await p.waitForTimeout(2500);
    await p.getByRole('switch').first().click(); await p.waitForTimeout(600);
    await scrollList(p, 220);
  }, wait: null },
];

async function run(browser, images, origin, flow) {
  const { context, page, activity } = await openContext(browser, { device, role: flow.role, origin, images });
  const file = path.join(OUT, `${flow.name}${suffix}.png`);
  try {
    await openScreen(page, activity, origin, flow.role, flow.target ?? '/', { extraQuery: demo ? '&demo=1' : '' });
    await waitForQuietNetwork(activity, 700, 12_000);
    await page.waitForTimeout(1200);
    await waitForImages(page, 6_000);
    if (flow.before) {
      await page.screenshot({ path: path.join(OUT, `${flow.name}-before${suffix}.png`) });
    }
    await flow.act(page, { longPress, swipeLeft, swipeRight });
    if (flow.wait) await page.getByTestId(flow.wait).first().waitFor({ timeout: 6_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: file });
    console.log(`Captured ${flow.name}${suffix}`);
  } catch (e) {
    console.error(`FAILED ${flow.name}${suffix}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: file.replace('.png', '-FAILED.png') }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(process.env.BUILD_DIR || DEFAULT_BUILD_DIR);
  try {
    for (const flow of FLOWS) {
      if (only.length && !only.includes(flow.name)) continue;
      await run(browser, images, origin, flow);
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
