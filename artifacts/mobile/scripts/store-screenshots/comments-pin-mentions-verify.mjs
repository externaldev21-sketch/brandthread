#!/usr/bin/env node
/**
 * Comments sheet in demo mode at 393x852: pinned comment + tappable @mention
 * text, and the mention suggestion strip above the composer.
 *
 * Usage: node --experimental-strip-types scripts/store-screenshots/comments-pin-mentions-verify.mjs [outDir] [buildDir]
 * (builds the web preview unless a buildDir with an existing export is given)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { collectTextFitIssues } from '../../e2e/helpers/textFit.ts';

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
    '/buyer-post-comments?postId=preview-fashion-01&postAuthorName=Forme%2022&postAuthorId=user_jordan&demo=1',
  );
  await waitForQuietNetwork(activity, 500, 10_000);
  await page.waitForTimeout(1200);
  let failed = 0;
  const check = async (name) => {
    const issues = await collectTextFitIssues(page);
    console.log(`text-fit ${name}: ${issues.length} issue(s)`);
    for (const i of issues) console.log(`  [${i.kind}] "${i.text}" ${i.detail}`);
    failed += issues.length;
  };
  const zoom = async (name, y0, y1) => page.screenshot({
    path: path.join(OUT, name), clip: { x: 0, y: y0, width: 393, height: y1 - y0 },
    scale: 'device',
  });
  await page.screenshot({ path: path.join(OUT, '01-comments-pinned-mention.png') });
  await check('pinned + mention text');
  await zoom('03-zoom-pinned-marker.png', 370, 480);

  const input = page.locator('textarea, input').last();
  await input.click();
  await input.fill('loving this @ma');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '02-comments-mention-suggestions.png') });
  await check('mention suggestion strip');
  await zoom('04-zoom-suggestion-strip.png', 650, 760);
  await input.fill('');
  await page.waitForTimeout(300);

  await page.getByText('saving this for later').first().hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '05-comment-actions-pin.png') });
  await check('actions sheet with Pin comment');
  await zoom('06-zoom-actions-sheet.png', 520, 852);
  console.log(failed ? `TEXT-FIT FAILED: ${failed}` : 'TEXT-FIT OK: 0 issues');
  await context.close();
} finally {
  await browser.close();
  server.close();
}
console.log('screenshots written to', OUT);
