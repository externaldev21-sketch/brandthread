#!/usr/bin/env node
/**
 * Live verification for the seller chat "buyer context panel" (item 144).
 * Drives the LOCAL Expo web dev server (started separately: `expo start
 * --web --port <N>`) against the seeded ?bt_preview=seller conversations
 * (lib/previewInboxData.ts's SELLER_PREVIEW_CONVERSATION_SEEDS):
 *   - preview-seller-conversation-01 (Ava Chen) has seeded `buyerOrders` ->
 *     populated state.
 *   - preview-seller-conversation-02 (Maya Torres) has none -> empty state.
 *
 *   node scripts/buyer-context-panel-screenshots.mjs --port <N>
 *
 * Output: docs/pr-review/seller-chat-buyer-context/390/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MOBILE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/seller-chat-buyer-context/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const portArg = process.argv.indexOf('--port');
const PORT = portArg >= 0 ? process.argv[portArg + 1] : '8151';
const ORIGIN = `http://localhost:${PORT}`;

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function dismissCookieBanner(page) {
  const acceptAll = page.getByText('Accept all').first();
  if (await acceptAll.isVisible().catch(() => false)) await acceptAll.click();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: UA,
      locale: 'en-US',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    // ── 1. Populated state: Ava Chen has 2 seeded orders with this seller ──
    const page1 = await context.newPage();
    await page1.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page1.getByTestId('seller-conversation-buyer-context-btn').waitFor({ timeout: 30_000 });
    await dismissCookieBanner(page1);
    await shot(page1, '01-seller-chat-header');

    await page1.getByTestId('seller-conversation-buyer-context-btn').click();
    await page1.getByText('Orders with you').first().waitFor({ timeout: 10_000 });
    await page1.getByTestId('buyer-context-order-preview-order-bt-10234').waitFor({ timeout: 10_000 });
    await shot(page1, '02-buyer-context-panel-populated');

    // ── 2. Tap-through: order row -> the real seller order-detail screen ───
    await page1.getByTestId('buyer-context-order-preview-order-bt-10234').click();
    await page1.waitForTimeout(1200);
    console.log(`  ✓ order row tap -> ${page1.url().replace(ORIGIN, '')}`);
    await shot(page1, '03-tap-through-order-detail');
    await page1.close();

    // ── 3. Empty state: Maya Torres has no other orders seeded ─────────────
    const page2 = await context.newPage();
    await page2.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-02&bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page2.getByTestId('seller-conversation-buyer-context-btn').waitFor({ timeout: 30_000 });
    await dismissCookieBanner(page2);
    await page2.getByTestId('seller-conversation-buyer-context-btn').click();
    await page2.getByText('Orders with you').first().waitFor({ timeout: 10_000 });
    await page2.getByText(/No other orders from/).first().waitFor({ timeout: 10_000 });
    await shot(page2, '04-buyer-context-panel-empty');
    await page2.close();

    console.log(`Wrote buyer context panel screenshots to ${OUT}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
