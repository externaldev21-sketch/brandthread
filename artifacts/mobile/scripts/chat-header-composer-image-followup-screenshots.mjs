#!/usr/bin/env node
/**
 * Before/after verification for the chat-header-composer-image follow-up PR
 * (Dev's live Orison-thread re-check of PR #317): header icon group
 * right-aligned to the edge, composer camera-circle button + Thread Cash
 * sizing, and resized chat card images. Drives the real dev-web build
 * (`pnpm exec expo start --web`) against the seeded `?bt_preview=buyer` /
 * `?bt_preview=seller` preview conversations — the real live Replit preview
 * domain is network-blocked in this sandbox, so this substitutes the local
 * Expo web dev server on BASE_URL, same substitution as PR #317's own
 * verification script (chat-card-redesign-screenshots.mjs).
 *
 *   BASE_URL=http://localhost:8734 node scripts/chat-header-composer-image-followup-screenshots.mjs
 *
 * Output: docs/pr-review/chat-header-composer-image-followup/390/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-header-composer-image-followup/390');
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
  try {
    await page.evaluate(() => {
      const el = document.getElementById('error-toast');
      if (el) { el.innerHTML = ''; el.style.display = 'none'; el.style.pointerEvents = 'none'; }
      const tabBar = document.querySelector('[data-testid="seller-global-tab-bar"]');
      if (tabBar instanceof HTMLElement) tabBar.style.display = 'none';
    });
  } catch { /* not present */ }
}

async function shot(page, name) {
  await dismissChrome(page);
  await page.waitForTimeout(600);
  await dismissChrome(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  captured ${name}`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  console.log('Buyer — header + composer…');
  await page.goto(`${BASE_URL}/buyer-conversation?id=preview-conversation-04&bt_preview=buyer`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(3500);
  await shot(page, '01-buyer-header-right-aligned');
  await shot(page, '02-buyer-composer-camera-circle');

  console.log('Seller — header + composer…');
  const page2 = await context.newPage();
  await page2.goto(`${BASE_URL}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller`, { waitUntil: 'load', timeout: 180000 });
  await page2.waitForTimeout(3500);
  await shot(page2, '03-seller-header-right-aligned');
  await shot(page2, '04-seller-composer');

  await browser.close();
  console.log('Done ->', OUT);
}

run().catch((e) => { console.error(e); process.exit(1); });
