#!/usr/bin/env node
/**
 * Live verification for photo/video send with upload progress ring (item 74).
 * Drives the LOCAL Expo web dev server (started separately: `expo start
 * --web --port <N>`) against the seeded ?bt_preview=buyer / ?bt_preview=
 * seller preview conversations, which now each carry a completed/resting
 * photo message and a completed/resting video message (see
 * lib/previewInboxData.ts's preview-conversation-07 / preview-seller-
 * conversation-01, and toAttachment()'s `image`/`video` branches in
 * lib/previewInbox.ts for the real bundled poster photo URI they attach).
 *
 * Captures:
 *   1. A completed photo + video message bubble at rest — buyer side.
 *   2. The upload-in-progress ring state on the composer's staged-attachment
 *      thumbnail. The real upload is too transient to reliably land a
 *      screenshot inside (uploadMedia() is a single fetch() that resolves or
 *      rejects as soon as it completes, and this sandbox has no reachable
 *      backend for it to genuinely hang on) — captured instead via the
 *      documented, clearly-commented verification aid
 *      (?bt_force_upload=1, gated to preview mode only — see the effect in
 *      app/buyer-conversation.tsx / app/seller-conversation.tsx) which
 *      force-stages a real bundled photo as "uploading" so the ring is
 *      screenshotted deterministically. This is NOT a screenshot of a real
 *      network upload in flight — documented honestly in the PR.
 *   3. The identical completed photo/video bubbles on the seller side —
 *      buyer<->seller cohesion, same component/behavior.
 *
 * Also runs a direct DOM nested-<button> check (querySelectorAll('button')
 * filtered for one containing another) against both the resting-message
 * view and the uploading-composer view, on both buyer and seller — the same
 * check that caught item 73's real nested-button bug.
 *
 *   node scripts/chat-media-upload-screenshots.mjs --port <N>
 *
 * Output: docs/pr-review/chat-media-upload/390/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MOBILE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-media-upload/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const portArg = process.argv.indexOf('--port');
const PORT = portArg >= 0 ? process.argv[portArg + 1] : '8167';
const ORIGIN = `http://localhost:${PORT}`;

async function shot(page, name) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function dismissCookieBanner(page) {
  const acceptAll = page.getByText('Accept all').first();
  if (await acceptAll.isVisible().catch(() => false)) await acceptAll.click();
}

async function dismissPreexistingLogBoxToast(page) {
  const toast = page.locator('text=/cannot contain a nested/i').first();
  if (!(await toast.isVisible().catch(() => false))) return;
  const closeIcon = toast.locator('xpath=ancestor::*[3]').locator('svg, [aria-label="Dismiss"], [aria-label="Close"]').last();
  await closeIcon.click({ timeout: 2000 }).catch(() => {});
}

/** Direct DOM nested-<button> check — the same class of bug item 73 found. */
async function checkNoNestedButtons(page, label) {
  const offenders = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons
      .filter((b) => b.querySelector('button'))
      .map((b) => b.outerHTML.slice(0, 160));
  });
  if (offenders.length) {
    console.error(`  ✗ NESTED <button> FOUND (${label}):`);
    offenders.forEach((o) => console.error(`      ${o}`));
    process.exitCode = 1;
  } else {
    console.log(`  ✓ no nested <button> (${label})`);
  }
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

    // ── 1. Buyer preview: completed photo + video bubbles at rest ─────────
    const buyerPage = await context.newPage();
    await buyerPage.goto(`${ORIGIN}/buyer-conversation?id=preview-conversation-07&bt_preview=buyer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await buyerPage.getByTestId('voice-message-bubble').first().waitFor({ timeout: 30_000 });
    await dismissCookieBanner(buyerPage);
    await dismissPreexistingLogBoxToast(buyerPage);
    await buyerPage.waitForTimeout(400);
    await shot(buyerPage, '01-photo-video-bubbles-at-rest-buyer');
    await checkNoNestedButtons(buyerPage, 'buyer, resting message list');

    // ── 2. Buyer preview: upload-in-progress ring (verification aid) ──────
    const buyerUploadPage = await context.newPage();
    await buyerUploadPage.goto(`${ORIGIN}/buyer-conversation?id=preview-conversation-07&bt_preview=buyer&bt_force_upload=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await buyerUploadPage.getByTestId('conversation-selected-attachment').waitFor({ timeout: 30_000 });
    await dismissCookieBanner(buyerUploadPage);
    await dismissPreexistingLogBoxToast(buyerUploadPage);
    await buyerUploadPage.waitForTimeout(400);
    await shot(buyerUploadPage, '02-upload-progress-ring-buyer');
    await checkNoNestedButtons(buyerUploadPage, 'buyer, uploading composer');

    // ── 3. Seller preview: identical completed bubbles, incoming/outgoing ─
    const sellerPage = await context.newPage();
    await sellerPage.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sellerPage.getByTestId('voice-message-bubble').first().waitFor({ timeout: 30_000 });
    await dismissCookieBanner(sellerPage);
    await dismissPreexistingLogBoxToast(sellerPage);
    await sellerPage.waitForTimeout(400);
    await shot(sellerPage, '03-photo-video-bubbles-seller-chat');
    await checkNoNestedButtons(sellerPage, 'seller, resting message list');

    // ── 4. Seller preview: upload-in-progress ring (verification aid) ─────
    const sellerUploadPage = await context.newPage();
    await sellerUploadPage.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller&bt_force_upload=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sellerUploadPage.getByTestId('seller-conversation-selected-attachment').waitFor({ timeout: 30_000 });
    await dismissCookieBanner(sellerUploadPage);
    await dismissPreexistingLogBoxToast(sellerUploadPage);
    await sellerUploadPage.waitForTimeout(400);
    await shot(sellerUploadPage, '04-upload-progress-ring-seller');
    await checkNoNestedButtons(sellerUploadPage, 'seller, uploading composer');

    console.log(`Wrote chat media upload screenshots to ${OUT}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
