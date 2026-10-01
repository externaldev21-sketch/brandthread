#!/usr/bin/env node
/**
 * Screenshots of the live moderation + co-host screens at 393x852 on the web
 * preview (demo data via `&demo=1`; the screens make no API calls in demo).
 *
 *   node scripts/live-moderation-cohost-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/claude/live-moderation-cohost/ (repo root)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude/live-moderation-cohost');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const SHOTS = [
  ['01-moderation', '/live-moderation?demo=1&streamId=demo'],
  ['02-cohost-invite-sheet', '/live-cohost?demo=1&streamId=demo'],
  ['03-cohost-invitee', '/live-cohost-invite?demo=1'],
];

mkdirSync(OUT, { recursive: true });
if (!process.argv.includes('--skip-build')) buildPreviewWeb();
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
const server = await serveBuild(DEFAULT_BUILD_DIR);
const origin = server.origin;
try {
  for (const [name, target] of SHOTS) {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
    await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await openScreen(page, activity, origin, 'seller', target);
    await page.waitForTimeout(1800);
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('saved', name);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close?.();
}
