#!/usr/bin/env node
/**
 * Thread pull-to-refresh — frames of the silver thread stitching across the
 * top of the Threads feed and Discover while they reload, at 393x852 on the
 * store-screenshots harness. The web build has no pull gesture, so the
 * script calls the feed's own RefreshControl `onRefresh` (found through the
 * React tree) and holds API responses for 2.5 s so the refresh stays visible.
 * A reduced-motion pass shows the still, fully stitched thread.
 *
 *   node scripts/thread-refresh-screenshots.mjs --build <web export dir> --tag <before|after>
 *
 * Output: docs/pr-assets/thread-refresh/<tag>-*.jpg
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BUILD = path.resolve(arg('build', path.join(WORK_DIR, 'web-build')));
const TAG = arg('tag', 'after');
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/thread-refresh');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SCREENS = [
  { name: 'threads', target: '/(buyer)', ready: 'Drop 04 is live' },
  { name: 'discover', target: '/(buyer)/discover', ready: 'Discover' },
];

/** Calls the onRefresh of the first RefreshControl in the React tree. */
async function triggerRefresh(page) {
  return page.evaluate(() => {
    const rootEl = document.getElementById('root') ?? document.body;
    const key = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$'));
    let fiber = key ? rootEl[key] : null;
    const stack = fiber ? [fiber] : [];
    while (stack.length) {
      const f = stack.pop();
      const props = f.memoizedProps;
      if (props && typeof props.onRefresh === 'function' && 'refreshing' in props) { props.onRefresh(); return true; }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return false;
  });
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      for (const screen of SCREENS) {
        const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
        const { context, page, activity } = await openContext(browser, {
          device, role: 'buyer', origin: server.origin, images, installClock: false, contextOptions: { reducedMotion },
        });
        let slow = false;
        await context.route((url) => url.hostname === 'api.brandthread.test', async (route) => {
          if (slow && route.request().method() !== 'OPTIONS') await new Promise((r) => setTimeout(r, 2500));
          return route.fallback();
        });
        for (let attempt = 0; ; attempt++) {
          await openScreen(page, activity, server.origin, 'buyer', screen.target);
          try { await page.getByText(screen.ready).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
        }
        await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(1500);
        const guide = page.getByTestId('feed-gesture-guide');
        if (await guide.isVisible().catch(() => false)) { await guide.click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(400); }
        slow = true;
        const ok = await triggerRefresh(page);
        console.log(`[${reducedMotion}] ${screen.name}: refresh triggered=${ok}`);
        const frames = reducedMotion === 'reduce' ? [300] : [150, 250, 250];
        for (let i = 0; i < frames.length; i++) {
          await page.waitForTimeout(frames[i]);
          const label = reducedMotion === 'reduce' ? `${screen.name}-reduce-motion` : `${screen.name}-${i}`;
          await page.screenshot({ path: path.join(OUT, `${TAG}-${label}.jpg`), type: 'jpeg', quality: 86 });
          console.log('  wrote', `${TAG}-${label}.jpg`, 'thread visible:', await page.getByTestId('thread-refresh').isVisible().catch(() => false));
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
