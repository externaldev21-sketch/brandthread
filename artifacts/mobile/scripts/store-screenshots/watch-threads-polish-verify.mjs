#!/usr/bin/env node
/**
 * Watch Threads follow-ups, hands-on at 390×844 (signed-in demo seller, dev
 * bundle with the harness env — see harness.mjs):
 *   1. Top bar: Back far left, bag far right (symmetric), Following · Threads
 *      dead center; no LIVE, no Search.
 *   2. Studio menu over a playing clip: every feed <video> paused and muted;
 *      closing the menu resumes the same clip in place; leaving through a
 *      menu card keeps it stopped.
 *   3. Tab bar highlight: on the Studio circle for a menu-opened screen with no
 *      tab of its own; back on Dashboard after tapping Dashboard.
 * The feed's first post is swapped for a real clip with sound
 * (watch-threads-helpers.mjs serveFeedToSeller videoFirst).
 *
 *   node scripts/store-screenshots/watch-threads-polish-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { currentPost, openWatchThreadsFromStudio, serveFeedToSeller } from './watch-threads-helpers.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/watch-threads-v3'));
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const { context, page, activity } = await openContext(browser, {
  device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true }, role: 'seller', origin: ORIGIN, images,
  // Real clock: the playback checks read the clip's currentTime advancing.
  installClock: false,
});
await serveFeedToSeller(context, { videoFirst: true });
page.setDefaultNavigationTimeout(300_000);
const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log(`  ✓ ${name}  ${new URL(page.url()).pathname}`); };

/** Feed videos (not the Studio menu's own muted header avatar). */
const feedVideos = () => page.evaluate(() => [...document.querySelectorAll('video')]
  .filter((v) => !v.closest('[data-testid="seller-studio-menu-open"]') && !v.closest('[data-testid="seller-studio-header"]'))
  .map((v) => ({ src: (v.currentSrc || v.src || '').split('/').pop(), paused: v.paused, muted: v.muted, t: Math.round(v.currentTime * 100) / 100, visible: (() => { const r = v.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; })() })));
const audible = (vs) => vs.filter((v) => !v.paused && !v.muted);
const playing = (vs) => vs.filter((v) => !v.paused);
/** Selected state of the seller bar's own controls (bottom-most copy of each). */
const barSelection = () => page.evaluate(() => {
  const pick = (sel) => [...document.querySelectorAll(sel)].map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.top > 700 && r.top < 844).sort((a, b) => b[1].top - a[1].top)[0]?.[0];
  const out = {};
  for (const [k, sel] of [['studio', '[data-testid="seller-bottom-menu"]'], ['dashboard', '[data-testid="seller-tab-index"]'], ['products', '[data-testid="seller-tab-products"]'], ['orders', '[data-testid="seller-tab-orders"]'], ['profile', '[data-testid="seller-tab-profile"]']]) {
    out[k] = pick(sel)?.getAttribute('aria-selected') ?? null;
  }
  return out;
});
const topmostBox = (label) => page.evaluate((label) => {
  for (const el of document.querySelectorAll(`[aria-label="${label}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.top > 300) continue;
    const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (t && (t === el || el.contains(t))) return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return null;
}, label);
const textBox = (text) => page.evaluate((text) => {
  for (const el of document.querySelectorAll('div, span')) {
    if (el.childElementCount || el.textContent.trim() !== text) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.top > 300 || r.top < 0) continue;
    const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (t && (t === el || el.contains(t) || t.contains(el))) return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return null;
}, text);
const touchDrag = async (cdp, x1, y1, x2, y2, steps = 16) => {
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', x1, y1);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.waitForTimeout(24); }
  await touch('touchEnd', x2, y2);
};
const cdp = await context.newCDPSession(page);

await openScreen(page, activity, ORIGIN, 'seller', '/');
await page.waitForTimeout(6000);
await page.addStyleTag({ content: '#error-toast { display: none !important; pointer-events: none !important; }' }).catch(() => {});

// ── Open Watch Threads from the menu ──
await openWatchThreadsFromStudio(page);
await page.waitForTimeout(5000);
// A tap on the clip area is the first gesture the web player needs for sound
// (hooks/useFeedSound.ts); a second tap resumes it (tap = pause/play).
await page.mouse.click(195, 420); await page.waitForTimeout(400); await page.mouse.click(195, 420);
await page.waitForTimeout(2500);
await shot('01-watch-threads-top-bar-and-highlight');

// ── 1. Top bar ──
const back = await topmostBox('Back');
const cart = await page.evaluate(() => {
  for (const el of document.querySelectorAll('[aria-label^="Open bag"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.top > 300) continue;
    const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (t && (t === el || el.contains(t))) return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return null;
});
const following = await textBox('Following');
const threads = await textBox('Threads');
const live = await textBox('LIVE');
const search = await topmostBox('Search');
console.log('  top bar boxes:', JSON.stringify({ back, cart, following, threads, live, search }));
check(!!back && back.x < 40, 'Back sits on the far left');
check(!!cart && cart.x + cart.w > 350, 'bag sits on the far right');
if (back && cart) {
  const leftGap = back.x; const rightGap = 390 - (cart.x + cart.w);
  check(Math.abs(leftGap - rightGap) <= 1, `Back and bag are symmetric (left ${leftGap.toFixed(1)}px, right ${rightGap.toFixed(1)}px)`);
  check(Math.abs((back.y + back.h / 2) - (cart.y + cart.h / 2)) <= 1, 'Back and bag share one center line');
}
if (following && threads) {
  const center = (following.x + threads.x + threads.w) / 2;
  check(Math.abs(center - 195) <= 2, `Following · Threads centered on the screen (center ${center.toFixed(1)} of 195)`);
}
check(!live, 'no LIVE tab');
check(!search, 'no Search icon');

// ── 3a. Highlight on the Studio circle ──
let sel = await barSelection();
console.log('  bar selection on Watch Threads:', JSON.stringify(sel));
check(sel.studio === 'true' && sel.dashboard !== 'true' && sel.products !== 'true' && sel.orders !== 'true' && sel.profile !== 'true', 'highlight is on the Studio circle, on no tab');
await page.screenshot({ path: path.join(OUT, '02-bar-highlight-on-studio-circle.png'), clip: { x: 0, y: 740, width: 390, height: 104 } });
console.log('  ✓ 02-bar-highlight-on-studio-circle (crop)');

// ── 2. Pause under the menu ──
const post = await currentPost(page);
let vids = await feedVideos();
console.log('  before menu:', JSON.stringify(vids.filter((v) => v.visible)));
check(playing(vids).length === 1, 'one feed clip is playing before the menu opens');
const before = playing(vids)[0];
await page.getByTestId('seller-bottom-menu').last().tap({ force: true });
await page.getByTestId('seller-control-center-item-watch-threads').waitFor({ timeout: 15_000 }).catch(async () => { await page.getByTestId('seller-bottom-menu').last().tap({ force: true }); });
await page.waitForTimeout(1500);
vids = await feedVideos();
console.log('  menu open:', JSON.stringify(vids.filter((v) => v.visible || !v.paused)));
check(playing(vids).length === 0, 'menu open: no feed clip playing');
check(audible(vids).length === 0, 'menu open: no feed clip audible');
const tHeld1 = vids.find((v) => v.src === before?.src)?.t;
await page.waitForTimeout(1500);
const tHeld2 = (await feedVideos()).find((v) => v.src === before?.src)?.t;
check(tHeld1 === tHeld2, `menu open: the clip's position holds still (${tHeld1}s → ${tHeld2}s)`);
await shot('03-menu-open-over-feed-silent');

await page.getByTestId('seller-studio-menu-close').last().tap({ force: true });
await page.waitForTimeout(2500);
vids = await feedVideos();
const resumed = vids.find((v) => v.src === before?.src);
console.log('  menu closed:', JSON.stringify(resumed));
check(!!resumed && !resumed.paused, 'menu closed: the same clip plays again');
check(!!resumed && resumed.t >= (tHeld2 ?? 0), `menu closed: resumed in place (from ${tHeld2}s, now ${resumed?.t}s)`);
check((await currentPost(page)) === post, `menu closed: still the same post (${post})`);
await shot('04-menu-closed-resumed');

// ── 3b. Dashboard tab from Watch Threads → highlight back on Dashboard ──
const barPoint = (testId) => page.evaluate((testId) => {
  const r = [...document.querySelectorAll(`[data-testid="${testId}"]`)].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.top > 700 && b.top < 844).sort((a, b) => b.top - a.top)[0];
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
}, testId);
const dashPoint = await barPoint('seller-tab-index');
await page.touchscreen.tap(dashPoint.x, dashPoint.y);
await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 10_000 }).catch(async () => { await shot('debug-dashboard-tap'); });
await page.waitForTimeout(1500);
sel = await barSelection();
console.log('  bar selection on Dashboard:', JSON.stringify(sel));
check(new URL(page.url()).pathname === '/', 'Dashboard tab from inside Watch Threads goes to the dashboard');
check(sel.dashboard === 'true' && sel.studio !== 'true', 'after tapping Dashboard: highlight back on Dashboard, off the Studio circle');
check(playing(await feedVideos()).length === 0, 'Dashboard: no feed clip playing');
await shot('05-dashboard-highlight-back');

// ── Back into Watch Threads (same post, highlight on the Studio circle again) ──
await openWatchThreadsFromStudio(page);
await page.waitForTimeout(3000);
sel = await barSelection();
check(sel.studio === 'true' && sel.dashboard !== 'true', 'reopened from the menu: highlight on the Studio circle again');
check((await currentPost(page)) === post, 'reopened on the same post');

// ── Leave through another menu card (Create post, the next slide) — stays stopped ──
await page.getByTestId('seller-bottom-menu').last().tap({ force: true });
await page.getByTestId('seller-control-center-item-watch-threads').waitFor({ timeout: 15_000 });
await page.waitForTimeout(1200);
await page.mouse.move(300, 450);
await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(300 - (44 * i) / 12, 451); await page.waitForTimeout(20); }
await page.mouse.up();
await page.waitForTimeout(300);
const leftUrl = page.url();
for (let i = 0; i < 3 && page.url() === leftUrl; i++) {
  await page.getByTestId('seller-control-center-item-post-video').tap({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForURL((u) => u !== leftUrl, { timeout: 4000 }).catch(() => {});
}
await page.waitForTimeout(2500);
vids = await feedVideos();
console.log(`  left via the menu to ${new URL(page.url()).pathname}:`, JSON.stringify(vids.filter((v) => !v.paused || !v.muted)));
check(!/watch-threads/.test(page.url()), `left Watch Threads through a menu card (${new URL(page.url()).pathname})`);
check(playing(vids).length === 0 && audible(vids).length === 0, 'after leaving through the menu: no feed clip playing or audible');
await shot('06-left-via-menu-card-silent');

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
