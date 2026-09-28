#!/usr/bin/env node
/**
 * Live verification for the Shop-the-Post two-step LIST -> DETAIL rebuild
 * (TikTok Shop / eBay Item-lineup pattern):
 *   - A post with 2+ tagged products opens on a half-height LIST step (a
 *     row per product: real thumbnail/name/price/seller+verified/sold
 *     count, a compact cart button) — no giant duplicate photo.
 *   - Tapping a row pushes to that product's DETAIL step within the same
 *     sheet (capped photo, size chips, shipping/returns line, sticky
 *     Add to cart / text-only Buy now), with a working back chevron.
 *   - A single-product post skips the list entirely and opens straight on
 *     DETAIL, with no back chevron at all.
 *
 * Drives the real web build at 390x844 against this repo's own screenshot
 * harness (scripts/store-screenshots — signed-in demo buyer, fake API):
 *   - post_demo_1 ("Field Shell Jacket — Rust" + "Utility Cargo Pant —
 *     Rust", Northline Studio, verified) — 2-product post → LIST step.
 *   - post_demo_2 ("Boxy Fleece Hoodie — Graphite", Ember & Ash, verified)
 *     — 1-product post → straight to DETAIL, no list, no back chevron.
 *
 *   node scripts/shop-sheet-list-detail-rebuild-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/shop-sheet-list-detail-rebuild/390/*.png
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/shop-sheet-list-detail-rebuild/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function openFeed(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/(buyer)');
    try { await page.getByText('Drop 04 is live').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  const guide = page.getByTestId('feed-gesture-guide');
  if (await guide.isVisible().catch(() => false)) {
    await guide.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  return { context, page };
}

async function swipeOnce(page) {
  const result = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    const scroller = candidates[0];
    if (!scroller) return { count: 0 };
    scroller.scrollTop += scroller.clientHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    return { count: candidates.length, after: scroller.scrollTop };
  });
  await page.waitForTimeout(700);
  return result;
}

async function isOnScreen(page, text) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && n.textContent?.includes(t));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
  }, text);
}

async function swipeUntilVisible(page, text, max = 6) {
  for (let i = 0; i < max; i++) {
    if (await isOnScreen(page, text)) return;
    await swipeOnce(page);
  }
  if (!(await isOnScreen(page, text))) throw new Error(`"${text}" never scrolled on-screen after ${max} swipes`);
}

/** The feed keeps neighboring (off-screen) post cells mounted — pick the
 *  shop-tag-pill whose own bounding box actually intersects the viewport. */
async function onScreenPill(page) {
  const all = page.getByTestId('shop-tag-pill');
  const count = await all.count();
  for (let i = 0; i < count; i++) {
    const el = all.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0 && box.y < VIEWPORT.height && box.y + box.height > 0) return el;
  }
  throw new Error('No on-screen shop-tag-pill found');
}

async function openSheet(page) {
  const pill = await onScreenPill(page);
  await pill.click({ timeout: 8_000 });
  await page.waitForTimeout(700);
  await (await onScreenPill(page)).click({ timeout: 8_000 });
  const sheet = page.getByTestId('shop-product-sheet');
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  return sheet;
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    // ── 2-product post: LIST step -> row tap -> DETAIL -> back -> DETAIL 2 ──
    {
      const { context, page } = await openFeed(browser, images, server.origin);
      const sheet = await openSheet(page);
      await page.waitForTimeout(300);
      await shot(page, '01-list-step-two-products');

      const rows = sheet.getByRole('button', { name: /^View .+\$\d/ });
      const rowCount = await rows.count();
      console.log('  list rows found:', rowCount);

      await rows.first().click();
      await waitForImages(page);
      await page.waitForTimeout(500);
      await shot(page, '02-detail-step-from-row-1-with-back-chevron');

      const backBtn = sheet.getByLabel('Back to products list');
      await backBtn.waitFor({ timeout: 5_000 });
      await backBtn.click();
      await page.waitForTimeout(500);
      await shot(page, '03-back-to-list-step');

      await rows.nth(1).click();
      await waitForImages(page);
      await page.waitForTimeout(500);
      await shot(page, '04-detail-step-from-row-2');

      await context.close();
    }

    // ── 1-product post: opens straight on DETAIL, no list, no back chevron ──
    {
      const { context, page } = await openFeed(browser, images, server.origin);
      await swipeUntilVisible(page, 'Boxy fleece in graphite');
      await waitForImages(page);
      await page.waitForTimeout(500);

      const sheet = await openSheet(page);
      await waitForImages(page);
      await page.waitForTimeout(400);
      await shot(page, '05-single-product-opens-straight-to-detail');

      const backBtn = sheet.getByLabel('Back to products list');
      const backCount = await backBtn.count();
      console.log('  single-product sheet back-chevron count (expect 0):', backCount);

      const addBtn = sheet.getByRole('button', { name: 'Add to cart' });
      const buyBtn = sheet.getByRole('button', { name: 'Buy now' });
      console.log('  before size pick — Add to cart disabled:', await addBtn.isDisabled(), '| Buy now disabled:', await buyBtn.isDisabled());

      const sizeChip = sheet.getByRole('radio').first();
      await sizeChip.scrollIntoViewIfNeeded();
      await sizeChip.click();
      await page.waitForTimeout(300);
      console.log('  after size pick — Add to cart disabled:', await addBtn.isDisabled(), '| Buy now disabled:', await buyBtn.isDisabled());
      await shot(page, '06-single-product-detail-size-picked-cta-enabled');

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`Wrote screenshots to ${OUT}`);
}

run().catch((error) => { console.error(error); process.exit(1); });
