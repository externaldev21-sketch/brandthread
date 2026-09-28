#!/usr/bin/env node
/**
 * Live verification for Thread Cash send-in-chat (item 72). Drives the
 * LOCAL Expo web dev server (started separately: `expo start --web --port
 * <N>`) against the seeded ?bt_preview=buyer / ?bt_preview=seller preview
 * conversations, and captures:
 *   1. Buyer composer: the send sheet mid-flow (amount selected, confirm
 *      screen) — monochrome chrome.
 *   2. The animated "You sent $X to {name}" confirmation moment right after
 *      a real send (SuccessCheck 'draw' — white ring/check, no color).
 *   3. The resulting chat bubble in the buyer's thread (the just-sent
 *      transfer, pending).
 *   4. A pre-seeded pending Thread Cash bubble in the buyer's chat
 *      (preview-conversation-06 — received from a seller, Accept visible).
 *   5. The identical bubble shape on the seller side
 *      (preview-seller-conversation-02 — received from a buyer, Accept
 *      visible) — buyer/seller cohesion.
 *
 *   node scripts/thread-cash-chat-screenshots.mjs --port <N>
 *
 * Output: docs/pr-review/chat-threadcash-send/390/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MOBILE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-threadcash-send/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const portArg = process.argv.indexOf('--port');
const PORT = portArg >= 0 ? process.argv[portArg + 1] : '8172';
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
    // Clerk is stubbed by simply never reaching it: the ?bt_preview=buyer/
    // seller bypass (lib/devPreview.ts) short-circuits auth entirely for
    // these seeded conversations, so no Clerk domain is ever requested by
    // this script — matching how scripts/order-card-screenshots.mjs (item
    // 71) verified the same routes.
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

    // ── 1-3. Buyer: send a new Thread Cash from the composer ──────────────
    const buyerPage = await context.newPage();
    await buyerPage.goto(
      `${ORIGIN}/buyer-conversation?id=preview-conversation-01&participantId=preview-seller-01&participantName=Test%20Seller&participantHandle=testseller&participantInitials=TS&type=buyer_to_seller&bt_preview=buyer`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 },
    );
    await dismissCookieBanner(buyerPage);
    const composerCoin = buyerPage.getByTestId('conversation-thread-cash');
    await composerCoin.waitFor({ timeout: 30_000 });
    await buyerPage.waitForTimeout(600); // let the mutual-follow preview check settle
    await composerCoin.click();
    await buyerPage.getByTestId('thread-cash-chip-10').waitFor({ timeout: 10_000 });
    await buyerPage.getByTestId('thread-cash-chip-10').click();
    await shot(buyerPage, '01-send-sheet-amount-selected');

    await buyerPage.getByTestId('thread-cash-continue').click();
    await buyerPage.getByTestId('thread-cash-confirm-send').waitFor({ timeout: 10_000 });
    await shot(buyerPage, '02-send-sheet-confirm');

    await buyerPage.getByTestId('thread-cash-confirm-send').click();
    // The animated "You sent $10.00 to @testseller" confirmation —
    // SuccessCheck's draw variant finishes its stroke around ~730ms; this
    // grabs it just after so the checkmark + headline are both settled and
    // legible (captures the confirmation moment's end state, noted
    // honestly per the verification instructions — a screenshot cannot
    // reliably catch a mid-draw animation frame).
    await buyerPage.getByTestId('thread-cash-sent-confirmation').waitFor({ timeout: 10_000 });
    await buyerPage.waitForTimeout(500);
    await shot(buyerPage, '03-send-confirmation-animated-checkmark');

    // Sheet auto-dismisses and the real chat bubble posts.
    await buyerPage.getByTestId('thread-cash-sent-confirmation').waitFor({ state: 'hidden', timeout: 10_000 });
    await buyerPage.waitForTimeout(400);
    await dismissCookieBanner(buyerPage);
    await buyerPage.waitForTimeout(200);
    await shot(buyerPage, '04-chat-bubble-after-send-buyer');

    // ── 5. Buyer: pre-seeded pending Thread Cash (received) ───────────────
    const buyerReceivedPage = await context.newPage();
    await buyerReceivedPage.goto(`${ORIGIN}/buyer-conversation?id=preview-conversation-06&bt_preview=buyer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissCookieBanner(buyerReceivedPage);
    await buyerReceivedPage.getByTestId('thread-cash-accept').first().waitFor({ timeout: 30_000 });
    await buyerReceivedPage.getByText('$5.00 Thread Cash').first().waitFor({ timeout: 10_000 });
    await shot(buyerReceivedPage, '05-chat-bubble-received-buyer');

    // ── 6. Seller: the identical bubble shape, received from a buyer ──────
    const sellerPage = await context.newPage();
    await sellerPage.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-02&bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissCookieBanner(sellerPage);
    await sellerPage.getByTestId('thread-cash-accept').first().waitFor({ timeout: 30_000 });
    await sellerPage.getByText('$10.00 Thread Cash').first().waitFor({ timeout: 10_000 });
    await shot(sellerPage, '06-chat-bubble-received-seller');

    console.log(`Wrote Thread Cash chat screenshots to ${OUT}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
