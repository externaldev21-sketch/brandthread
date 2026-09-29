#!/usr/bin/env node
/**
 * Live realtime (WebSocket + presence + Agora web guard) — visual proof.
 *
 *   node scripts/live-realtime-screenshots.mjs [--skip-build] [--out=<dir>]
 *
 * Output: docs/pr-review/live-realtime-websocket-presence/390/<shot>.png
 *
 * What this proves:
 *  1. `/live?bt_preview=buyer` — the preview LIVE pager (app/live.tsx) is
 *     untouched by this PR (no WebSocket, no presence, no Agora changes
 *     reach it — see lib/live/liveProvider.ts) — same layout as before.
 *  2. `/buyer-live` and `/seller-live` on web — Platform.OS === 'web' still
 *     renders the pre-existing NativeOnlyFeature "Watch/broadcast in the
 *     app" state cleanly, not a crash, with the react-native-agora import
 *     guarded by a try/require (Part 3).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(MOBILE_ROOT, 'docs/pr-review/live-realtime-websocket-presence/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };

async function run() {
  mkdirSync(OUT, { recursive: true });

  if (!process.argv.includes('--skip-build')) {
    buildPreviewWeb();
  } else if (!existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    throw new Error('--skip-build passed but no existing build found — run once without it first.');
  }

  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();

  async function shot(page, name) {
    await waitForImages(page);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}`);
  }

  /**
   * The app's root auth-gate occasionally bounces a fresh client-side
   * pushState navigation back to "/" if it re-evaluates before the target
   * route has fully settled (a harness/timing quirk, not something this PR
   * touches). Re-fires the same navigation once if that happens.
   */
  async function gotoAndSettle(page, activity, origin, role, target) {
    await openScreen(page, activity, origin, role, target);
    await waitForQuietNetwork(activity, 800, 10_000);
    await page.waitForTimeout(1500);
    if (!page.url().includes(target.split('?')[0])) {
      await page.evaluate((url) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
      await waitForQuietNetwork(activity, 800, 10_000);
      await page.waitForTimeout(1500);
    }
  }

  try {
    // 1. Preview LIVE pager — untouched, same layout Dev already approved.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
      await gotoAndSettle(page, activity, server.origin, 'buyer', '/live');
      await shot(page, '01-live-preview-pager-unchanged');
      await context.close();
    }

    // 2. buyer-live.tsx on web — Agora-guarded fallback, no crash.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
      await gotoAndSettle(page, activity, server.origin, 'buyer', '/buyer-live?streamId=demo-stream');
      await shot(page, '02-buyer-live-web-fallback');
      await context.close();
    }

    // 3. seller-live.tsx on web — same Agora-guarded fallback.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images: {} });
      await gotoAndSettle(page, activity, server.origin, 'seller', '/seller-live?streamId=demo-stream');
      await shot(page, '03-seller-live-web-fallback');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
