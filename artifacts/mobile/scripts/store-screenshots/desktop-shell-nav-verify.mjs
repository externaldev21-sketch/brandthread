#!/usr/bin/env node
/**
 * Drives the desktop web shell by hand (components/web/DesktopShell.tsx):
 *
 * Desktop (1440x900 and 1280x800)
 *  - seller: sidebar + top bar present, no bottom tab bar / Studio button;
 *    open Products, Orders, Analytics and More-screen destinations from the
 *    sidebar (URL and highlighted item follow), browser Back retraces them,
 *    the top-bar search jumps to a tool, the hamburger collapses the sidebar
 *    to icons and expands it again.
 *  - buyer: sidebar destinations, Discover's wider grid, the two-column
 *    product page.
 * Phone (390x844)
 *  - no desktop shell; the seller bottom bar, its Studio button (which opens
 *    the radial menu) and the buyer bottom bar are all still there.
 *
 * Every check also asserts the page never scrolls horizontally. Screenshots
 * of each step land in --out.
 *
 *   node scripts/store-screenshots/desktop-shell-nav-verify.mjs --out <dir> [--build-dir <dir>]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const failures = [];
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`);
  else { console.log(`  FAIL ${message}`); failures.push(message); }
}

const byTestId = (page, id) => page.locator(`[data-testid="${id}"]`);
const visible = (page, id) => byTestId(page, id).first().isVisible().catch(() => false);
const pathname = (page) => page.evaluate(() => location.pathname.replace(/\/\([a-z]+\)/g, '') || '/');
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function open(page, activity, origin, role, target) {
  const want = target.replace(/\/\([a-z]+\)/g, '').split('?')[0] || '/';
  for (let attempt = 0; attempt < 4; attempt++) {
    await openScreen(page, activity, origin, role, target, { extraQuery: '&demo=1' });
    await page.waitForTimeout(2500);
    if (await pathname(page) === want) break;
  }
  await waitForQuietNetwork(activity, 900, 15_000);
  const later = page.getByText('Continue setup later');
  if (await later.isVisible().catch(() => false)) {
    await later.click();
    await page.waitForTimeout(1200);
  }
}

async function settle(page, activity) {
  await page.waitForTimeout(1200);
  await waitForQuietNetwork(activity, 700, 10_000);
  await waitForImages(page, 5_000);
}

async function sellerDesktop(browser, origin, images, viewport, out) {
  console.log(`seller ${viewport.width}x${viewport.height}`);
  const tag = `${viewport.width}`;
  const { context, page, activity } = await openContext(browser, { device: { viewport, scale: 1, isMobile: false }, role: 'seller', origin, images });
  try {
    await open(page, activity, origin, 'seller', '/(tabs)');
    check(await visible(page, 'desktop-sidebar'), 'sidebar renders');
    check(await visible(page, 'desktop-top-bar'), 'top bar renders');
    check(!(await visible(page, 'seller-global-tab-bar')), 'bottom tab bar does not render');
    check(!(await visible(page, 'seller-bottom-menu')), 'Studio radial-menu button does not render');
    check(await noHorizontalScroll(page), 'dashboard: no horizontal scroll');
    await page.screenshot({ path: path.join(out, `seller-${tag}-dashboard.png`) });

    const steps = [
      ['products', '/products'],
      ['orders', '/orders'],
      ['analytics', '/analytics'],
      ['store-builder', '/store-builder'],
      ['discounts', '/discounts'],
      ['manufacturer-hub', '/manufacturer-hub'],
      ['messages', '/seller-inbox'],
      ['payouts', '/payouts'],
    ];
    const visited = ['/'];
    for (const [id, want] of steps) {
      await byTestId(page, `desktop-nav-${id}`).click();
      await settle(page, activity);
      const at = await pathname(page);
      check(at === want, `sidebar ${id} opens ${want} (at ${at})`);
      const selected = await byTestId(page, `desktop-nav-${id}`).getAttribute('aria-current');
      check(selected === 'page', `sidebar ${id} is highlighted`);
      check(await noHorizontalScroll(page), `${id}: no horizontal scroll`);
      check(!(await visible(page, 'seller-global-tab-bar')), `${id}: still no bottom tab bar`);
      visited.push(at);
      await page.screenshot({ path: path.join(out, `seller-${tag}-${id}.png`) });
    }

    // Back retraces the sidebar trail (stack history, same routes as the phone).
    await page.goBack();
    await settle(page, activity);
    const back = await pathname(page);
    check(back === visited[visited.length - 2], `browser Back returns to ${visited[visited.length - 2]} (at ${back})`);

    // A tab destination from a pushed screen pops back to the tab group.
    await byTestId(page, 'desktop-nav-dashboard').click();
    await settle(page, activity);
    check(await pathname(page) === '/', 'sidebar dashboard returns to the dashboard');
    check(await byTestId(page, 'desktop-nav-dashboard').getAttribute('aria-current') === 'page', 'sidebar dashboard is highlighted');

    // Top-bar search jumps to a seller tool.
    await byTestId(page, 'desktop-top-bar-search').fill('gift');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `seller-${tag}-search.png`) });
    await page.getByRole('link', { name: /Gift cards/ }).last().click();
    await settle(page, activity);
    check(await pathname(page) === '/gift-cards-manage', 'top-bar search opens Gift cards');

    // Collapse to icons, then expand again.
    const sidebar = byTestId(page, 'desktop-sidebar');
    const expandedWidth = (await sidebar.boundingBox()).width;
    await byTestId(page, 'desktop-sidebar-toggle').click();
    await page.waitForTimeout(600);
    const collapsedWidth = (await sidebar.boundingBox()).width;
    check(collapsedWidth < expandedWidth && collapsedWidth <= 80, `hamburger collapses the sidebar (${expandedWidth} -> ${collapsedWidth})`);
    check(await noHorizontalScroll(page), 'collapsed: no horizontal scroll');
    await byTestId(page, 'desktop-nav-dashboard').click();
    await settle(page, activity);
    await page.screenshot({ path: path.join(out, `seller-${tag}-collapsed.png`) });
    await byTestId(page, 'desktop-sidebar-toggle').click();
    await page.waitForTimeout(600);
    check((await sidebar.boundingBox()).width === expandedWidth, 'hamburger expands it again');
  } finally {
    await context.close();
  }
}

async function buyerDesktop(browser, origin, images, viewport, out) {
  console.log(`buyer ${viewport.width}x${viewport.height}`);
  const tag = `${viewport.width}`;
  const { context, page, activity } = await openContext(browser, { device: { viewport, scale: 1, isMobile: false }, role: 'buyer', origin, images });
  await context.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch {} }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
  try {
    await open(page, activity, origin, 'buyer', '/(buyer)');
    check(await visible(page, 'desktop-sidebar'), 'sidebar renders');
    check(!(await visible(page, 'buyer-bottom-tab-bar')), 'bottom tab bar does not render');
    const feed = await byTestId(page, 'desktop-shell-content').boundingBox();
    const centre = feed.x + feed.width / 2;
    const room = (await byTestId(page, 'desktop-sidebar').boundingBox()).width;
    check(Math.abs(centre - (room + (viewport.width - room) / 2)) < 2, `feed column is centered (${Math.round(feed.width)}px wide)`);
    await page.screenshot({ path: path.join(out, `buyer-${tag}-feed.png`) });

    for (const [id, want] of [['discover', '/discover'], ['messages', '/inbox'], ['activity', '/activity'], ['profile', '/profile'], ['home', '/']]) {
      await byTestId(page, `desktop-nav-${id}`).click();
      await settle(page, activity);
      const at = await pathname(page);
      check(at === want, `sidebar ${id} opens ${want} (at ${at})`);
      check(await noHorizontalScroll(page), `${id}: no horizontal scroll`);
    }

    await byTestId(page, 'desktop-nav-discover').click();
    await settle(page, activity);
    await page.screenshot({ path: path.join(out, `buyer-${tag}-discover.png`) });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 2600);
    await settle(page, activity);
    await page.screenshot({ path: path.join(out, `buyer-${tag}-discover-grid.png`) });

    await open(page, activity, origin, 'buyer', '/buyer-product-detail?productId=prod_nl_jacket_rust');
    await settle(page, activity);
    const gallery = await byTestId(page, 'product-gallery-photo').first().boundingBox();
    const price = await page.getByText('Field Shell Jacket — Rust').first().boundingBox();
    check(gallery && price && price.x > gallery.x + gallery.width, 'product page: info sits right of the gallery');
    check(await noHorizontalScroll(page), 'product page: no horizontal scroll');
    await page.screenshot({ path: path.join(out, `buyer-${tag}-product.png`) });
  } finally {
    await context.close();
  }
}

async function phone(browser, origin, images, out) {
  console.log('phone 390x844');
  const viewport = { width: 390, height: 844 };
  {
    const { context, page, activity } = await openContext(browser, { device: { viewport, scale: 1, isMobile: true }, role: 'seller', origin, images });
    try {
      await open(page, activity, origin, 'seller', '/(tabs)');
      check(!(await visible(page, 'desktop-sidebar')), 'seller: no sidebar');
      check(await visible(page, 'seller-global-tab-bar'), 'seller: bottom tab bar renders');
      check(await visible(page, 'seller-bottom-menu'), 'seller: Studio radial-menu button renders');
      await byTestId(page, 'seller-bottom-menu').click();
      await page.waitForTimeout(1500);
      check(await visible(page, 'seller-studio-card-area'), 'seller: Studio radial menu opens');
      await page.screenshot({ path: path.join(out, 'phone-seller-radial-menu.png') });
    } finally {
      await context.close();
    }
  }
  {
    const { context, page, activity } = await openContext(browser, { device: { viewport, scale: 1, isMobile: true }, role: 'buyer', origin, images });
    await context.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch {} }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
    try {
      await open(page, activity, origin, 'buyer', '/(buyer)');
      check(!(await visible(page, 'desktop-sidebar')), 'buyer: no sidebar');
      check(await visible(page, 'buyer-bottom-tab-bar'), 'buyer: bottom tab bar renders');
    } finally {
      await context.close();
    }
  }
}

async function main() {
  const out = path.resolve(arg('--out') ?? 'scratch/desktop-shell-nav');
  const buildDir = path.resolve(arg('--build-dir') ?? DEFAULT_BUILD_DIR);
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--build') || !existsSync(path.join(buildDir, 'index.html'))) buildPreviewWeb(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(DEFAULT_BUILD_DIR), 'demo-images'));
  const { origin, close } = await serveBuild(buildDir);
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await sellerDesktop(browser, origin, images, viewport, out);
      await buyerDesktop(browser, origin, images, viewport, out);
    }
    await phone(browser, origin, images, out);
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
