#!/usr/bin/env node
/**
 * Before/after verification for the chat-card-redesign PR (Dev's Orison
 * chat feedback): standalone product/order cards, header icon spacing, and
 * the composer redesign. Drives the real dev-web build
 * (`pnpm exec expo start --web`) against the seeded `?bt_preview=buyer` /
 * `?bt_preview=seller` preview conversations — the real live Replit preview
 * domain is network-blocked in this sandbox, so this substitutes the local
 * Expo web dev server on BASE_URL, per this PR's own verification notes.
 *
 *   BASE_URL=http://localhost:8734 node scripts/chat-card-redesign-screenshots.mjs
 *
 * Output: docs/pr-review/chat-header-cards-composer/390/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-header-cards-composer/390');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8734';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function dismissChrome(page) {
  for (const label of ['Accept all', 'Dismiss', 'Close']) {
    const btn = page.getByText(label, { exact: true }).first();
    try {
      if (await btn.isVisible()) await btn.click({ timeout: 1000 });
    } catch { /* not present */ }
  }
  // The error-toast host div is always present in the DOM (even empty) and
  // sits on top of the composer, intercepting pointer events for any real
  // click underneath it — always clear it out rather than relying on a
  // visibility check.
  try {
    await page.evaluate(() => {
      const el = document.getElementById('error-toast');
      if (el) { el.innerHTML = ''; el.style.display = 'none'; el.style.pointerEvents = 'none'; }
      // Deep-linking straight to a conversation route outside real in-app
      // tab navigation (this sandbox harness, not a device) leaves the
      // global bottom tab bar floating over the composer — a pre-existing
      // dev-preview-only artifact, unrelated to this PR. Hidden here purely
      // so the screenshot shows the real composer underneath it.
      const tabBar = document.querySelector('[data-testid="seller-global-tab-bar"]');
      if (tabBar instanceof HTMLElement) tabBar.style.display = 'none';
    });
  } catch { /* not present */ }
}

async function shot(page, name) {
  await dismissChrome(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  captured ${name}`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  // ── Buyer: Orison thread — product card + unavailable product card ──────
  console.log('Buyer — Orison product cards…');
  await page.goto(`${BASE_URL}/buyer-conversation?id=preview-conversation-04&bt_preview=buyer`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  await shot(page, '01-buyer-header');
  await shot(page, '02-buyer-product-card');

  // Scroll to the unavailable card (last message in the thread).
  const unavailableCard = page.locator('[data-testid="product-card-attachment"]').last();
  await unavailableCard.scrollIntoViewIfNeeded();
  await shot(page, '03-buyer-product-card-unavailable');

  await shot(page, '04-buyer-composer-empty');
  await dismissChrome(page);
  await page.evaluate(() => {
    const el = document.querySelector('textarea, input[type="text"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, 'On my way!');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await shot(page, '05-buyer-composer-typed-send-visible');

  // ── Seller: order card (Kuro Line thread) ────────────────────────────────
  console.log('Seller — order card…');
  const page2 = await context.newPage();
  await page2.goto(`${BASE_URL}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller`, { waitUntil: 'load' });
  await page2.waitForTimeout(3500);
  await shot(page2, '06-seller-header');
  const orderCard = page2.locator('[data-testid="order-card-attachment"]').last();
  await orderCard.scrollIntoViewIfNeeded();
  await shot(page2, '07-seller-order-card');
  await shot(page2, '08-seller-composer-empty');
  await dismissChrome(page2);
  await page2.evaluate(() => {
    const el = document.querySelector('textarea, input[type="text"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, 'Thanks for checking!');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await shot(page2, '09-seller-composer-typed-send-visible');

  await browser.close();
  console.log('Done ->', OUT);
}

run().catch((e) => { console.error(e); process.exit(1); });
