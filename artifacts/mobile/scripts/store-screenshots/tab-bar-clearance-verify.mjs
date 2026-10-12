#!/usr/bin/env node
/**
 * Tab-bar clearance check: opens every buyer + seller tab-root screen at
 * 390x844 (fresh account and &demo=1), scrolls each scroll view to its end,
 * and measures the last piece of content against the top of the floating tab
 * bar. Saves a screenshot of the scrolled-to-bottom state per screen and
 * prints the gap (negative = content hidden behind the bar).
 *
 *   node scripts/store-screenshots/tab-bar-clearance-verify.mjs --out <dir> [--build] [--only a,b]
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

const TAB_ROOTS = [
  { id: 'buyer-discover', role: 'buyer', path: '/(buyer)/discover' },
  { id: 'buyer-inbox', role: 'buyer', path: '/(buyer)/inbox' },
  { id: 'buyer-activity', role: 'buyer', path: '/(buyer)/activity' },
  // Same screen with a list longer than the viewport (harness-only rows), so
  // the end of the scroll is actually reachable under the bar.
  { id: 'buyer-activity-long', role: 'buyer', path: '/(buyer)/activity', longActivity: true },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile' },
  { id: 'buyer-orders', role: 'buyer', path: '/(buyer)/orders' },
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)' },
  { id: 'seller-orders', role: 'seller', path: '/(tabs)/orders' },
  { id: 'seller-products', role: 'seller', path: '/(tabs)/products' },
  { id: 'seller-analytics', role: 'seller', path: '/(tabs)/analytics' },
  { id: 'seller-profile', role: 'seller', path: '/(tabs)/profile' },
  { id: 'seller-more', role: 'seller', path: '/(tabs)/more' },
  { id: 'seller-studio', role: 'seller', path: '/(tabs)/studio' },
];

const VARIANTS = [
  { id: 'fresh', demo: false },
  { id: 'demo', demo: true },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Scrolls every scroll view to its end and returns the gap between the
 *  lowest visible content and the top of the tab bar (CSS px). */
async function measure(page) {
  return page.evaluate(async () => {
    const bar = document.querySelector('[data-testid="seller-global-tab-bar"], [data-testid="buyer-bottom-tab-bar"]');
    const scrollers = [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.getBoundingClientRect().height > 200;
    });
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
    await new Promise((r) => setTimeout(r, 900));
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
    await new Promise((r) => setTimeout(r, 600));
    if (!bar) return { bar: null, scrollers: scrollers.length };
    // The visible part of the bar: the lowest-top child with real size.
    const barTop = Math.min(...[...bar.querySelectorAll('*')]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 30 && r.height > 30)
      .map((r) => r.top));
    let lowest = 0;
    const main = scrollers.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (main) {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (bar.contains(n)) continue;
        const r = n.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.top > window.innerHeight) continue;
        const cs = getComputedStyle(n);
        const visible = n.childElementCount === 0 || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px';
        if (visible && r.bottom > lowest && r.bottom <= window.innerHeight + 1) lowest = r.bottom;
      }
    }
    return { barTop: Math.round(barTop), lowestContent: Math.round(lowest), gap: Math.round(barTop - lowest), scrollers: scrollers.length };
  });
}

async function main() {
  const out = path.resolve(arg('--out') ?? 'scratch/tab-bar-clearance');
  const only = arg('--only')?.split(',');
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(DEFAULT_BUILD_DIR), 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const results = [];
  try {
    for (const screen of TAB_ROOTS.filter((s) => !only || only.includes(s.id))) {
      for (const v of VARIANTS) {
        const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
        const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
        const file = path.join(out, `${screen.id}-${v.id}.png`);
        try {
          if (screen.longActivity) {
            const rows = Array.from({ length: 16 }, (_, i) => ({
              id: `n-like-long-${i}`, category: 'social', type: 'post_like',
              title: `Reader ${i + 1} liked your post`, body: '', isRead: true, isMuted: false,
              actorId: `demo-liker-long-${i}`, actorName: `Reader ${i + 1}`, actorHandle: `@reader${i + 1}`,
              actorInitials: `R${i + 1}`, actorColor: '#3B82F6', targetId: `post-long-${i}`, targetType: 'post',
              createdAt: new Date(Date.now() - (i + 2) * 86_400_000).toISOString(),
            }));
            await page.route(/\/buyer\/notifications(\?|$)/, (route) => route.fulfill({ json: rows }));
          }
          if (screen.role === 'buyer') {
            await context.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch {} }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
          }
          const want = screen.path.replace(/\/\([a-z]+\)/g, '').split('?')[0] || '/';
          for (let attempt = 0; attempt < 4; attempt++) {
            if (v.demo) {
              // demo=1 is read from the first page load, so load the screen directly.
              await page.goto(`${origin}${screen.path}${screen.path.includes('?') ? '&' : '?'}bt_preview=${screen.role}&demo=1`);
              await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
            } else {
              await openScreen(page, activity, origin, screen.role, screen.path);
            }
            await page.waitForTimeout(2500);
            const at = await page.evaluate(() => location.pathname.replace(/\/\([a-z]+\)/g, '') || '/');
            if (at === want) break;
          }
          await waitForQuietNetwork(activity, 900, 15_000);
          await waitForImages(page, 8_000);
          await page.waitForTimeout(2000);
          const m = await measure(page);
          await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
          results.push({ screen: screen.id, variant: v.id, ...m });
          console.log(`${screen.id} ${v.id} ${JSON.stringify(m)}`);
        } catch (e) {
          console.log(`FAILED ${screen.id} ${v.id} ${String(e.message).split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
