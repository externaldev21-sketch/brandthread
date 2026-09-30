#!/usr/bin/env node
/**
 * One-off live verification for the cross-cutting audit fixes PR — not part
 * of the store screenshot pipeline. Captures at 393x852 (the audit's own
 * viewport):
 *   1. root.png       — "/" now redirects to the dashboard under
 *                        ?bt_preview=seller in the exported (non-__DEV__)
 *                        preview build, instead of hanging on the bare boot
 *                        logo forever (see app/index.tsx).
 *   2. content.png    — /content's overview stats row, to confirm the
 *                        repeated-labels heuristic fix didn't change any
 *                        actual rendered UI (only the audit script changed).
 *   3. seller-settings.png — a PressableScale-heavy screen, to confirm the
 *                        new default hitSlop changed no visual sizing
 *                        (hitSlop only extends the touch target).
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/crosscutting-fixes-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/audit-crosscutting-fixes/393'));
mkdirSync(OUT, { recursive: true });

const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function shootRoot(browser, images, origin, role, filename) {
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await page.goto(`${origin}/?bt_preview=${role}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  // Give the redirect-away-from-"/" effect its full window (50ms timeout +
  // navigation) before deciding where we landed.
  await page.waitForTimeout(1500);
  await waitForQuietNetwork(activity, 500, 8_000);
  await waitForImages(page, 6_000);
  await page.screenshot({ path: path.join(OUT, filename) });
  console.log(`${filename}: landed on ${page.url()}`);
  await context.close();
}

async function shootScreen(browser, images, origin, role, target, filename) {
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  // A full navigation straight to the target route (instead of the
  // load-root-then-pushState two-step openScreen() does) so this capture
  // never touches "/" — root's own redirect-away effect is a different
  // screen, irrelevant here and only adds a timing race against it.
  await page.goto(`${origin}${target}?bt_preview=${role}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 500, 8_000);
  await page.waitForTimeout(400);
  await waitForImages(page, 6_000);
  await page.screenshot({ path: path.join(OUT, filename) });
  console.log(`Captured ${filename}: ${page.url()}`);
  await context.close();
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    await shootRoot(browser, images, origin, 'seller', 'root-after.png');
    await shootScreen(browser, images, origin, 'seller', '/content', 'content.png');
    await shootScreen(browser, images, origin, 'seller', '/seller-settings', 'seller-settings.png');
  } finally {
    close();
    await browser.close();
  }
  console.log(`\nWrote screenshots to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
