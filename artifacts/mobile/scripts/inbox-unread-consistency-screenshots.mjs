#!/usr/bin/env node
/**
 * Live verification for item 64 (inbox unread/read row consistency audit —
 * see docs/pr-review/inbox-unread-consistency). Drives the real web build
 * (store-screenshots harness: signed-in demo seller, seeded storage, fake
 * API) at 390x844 and captures the seller inbox, showing unread (bold name
 * + preview + trailing dot) vs read (regular weight, no dot) rows — the
 * same Threads/Instagram-style convention app/(buyer)/inbox.tsx already
 * used, which app/seller-inbox.tsx did not match until this item's fix.
 *
 * The buyer inbox's own before/after (01*.png in the same output folder)
 * was captured separately via the plain `expo start --web` dev server with
 * ?bt_preview=buyer, since lib/previewInbox.ts's richer seeded thread set
 * (typing state, live rings, muted/official rows) is dev-only (__DEV__) and
 * not present in this harness's production export.
 *
 *   node scripts/inbox-unread-consistency-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/inbox-unread-consistency/390/02-seller-inbox.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/inbox-unread-consistency/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function shoot(browser, { role, target, origin, images, out, readyText }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  // A direct goto (rather than the harness's usual land-on-"/"-then-
  // client-navigate openScreen helper) is what reliably lands seller-inbox
  // here — the exported build's SPA fallback (server/serve.js) serves
  // index.html for any path, so this is a normal deep link.
  await page.goto(`${origin}${target}?bt_preview=${role}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.getByText(readyText).first().waitFor({ timeout: 20_000 });
  await waitForImages(page);
  await page.waitForTimeout(600);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, out) });
  await context.close();
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
    await shoot(browser, {
      role: 'seller', target: '/seller-inbox', origin, images,
      out: '02-seller-inbox.png', readyText: 'Jordan Reyes',
    });
  } finally {
    await browser.close();
    close();
  }
  console.log(`Wrote screenshots to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
