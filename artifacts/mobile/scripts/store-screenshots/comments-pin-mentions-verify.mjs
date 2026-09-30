#!/usr/bin/env node
/**
 * Comments sheet in demo mode at 393x852: pinned comment + tappable @mention
 * text, and the mention suggestion strip above the composer.
 *
 * Usage: node scripts/store-screenshots/comments-pin-mentions-verify.mjs [outDir] [buildDir]
 * (builds the web preview unless a buildDir with an existing export is given)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/comments-pin-mentions'));
const BUILD = path.resolve(process.argv[3] ?? DEFAULT_BUILD_DIR);
mkdirSync(OUT, { recursive: true });
if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);

const server = await serveBuild(BUILD);
const browser = await launchBrowser();
try {
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
  page.setDefaultNavigationTimeout(120_000);
  await openScreen(
    page, activity, server.origin, 'buyer',
    '/buyer-post-comments?postId=preview-fashion-01&postAuthorName=Forme%2022&postAuthorId=preview-author&demo=1',
  );
  await waitForQuietNetwork(activity, 500, 10_000);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '01-comments-pinned-mention.png') });

  const input = page.locator('textarea, input').last();
  await input.click();
  await input.fill('loving this @ma');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '02-comments-mention-suggestions.png') });
  await context.close();
} finally {
  await browser.close();
  server.close();
}
console.log('screenshots written to', OUT);
