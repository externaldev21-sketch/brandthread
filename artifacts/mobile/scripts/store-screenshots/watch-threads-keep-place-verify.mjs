#!/usr/bin/env node
/**
 * Watch Threads keeps your place, and keeps the seller tab bar.
 * 390×844, signed-in demo seller, dev bundle (harness env, see harness.mjs):
 *   01 Studio → Watch Threads (seller tab bar on screen)
 *   02 swiped down two posts
 *   03 Dashboard tab tapped from inside the feed → dashboard
 *   04 Studio → Watch Threads again → the SAME post, not the top
 *   05 Products tab from the feed, 06 back into Watch Threads via Back → same post
 *
 *   node scripts/store-screenshots/watch-threads-keep-place-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { currentPost, openWatchThreadsFromStudio, serveFeedToSeller, swipeUp } from './watch-threads-helpers.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/watch-threads-v2'));
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const { context, page, activity } = await openContext(browser, { device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true }, role: 'seller', origin: ORIGIN, images });
await serveFeedToSeller(context);
page.setDefaultNavigationTimeout(300_000);
const cdp = await context.newCDPSession(page);
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log(`  ✓ ${name}  ${new URL(page.url()).pathname}  post: ${await currentPost(page)}`); };
const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const tabBarVisible = async () => { const b = await (await barButton('Dashboard tab'))?.boundingBox(); return !!b && b.y > 700 && b.y < 844; };
// The seller bar's own button: the bottom-most element with that label
// (retained screens — e.g. Profile's own "Products tab" — share some labels).
const barButton = async (label) => {
  const all = page.getByLabel(label, { exact: true });
  let best = null; let bestY = -1;
  for (let i = 0; i < await all.count(); i++) { const b = await all.nth(i).boundingBox(); if (b && b.y > bestY && b.y < 844) { bestY = b.y; best = all.nth(i); } }
  return best;
};
const tapTab = async (label, urlRe) => {
  const t0 = Date.now();
  await (await barButton(label)).tap({ force: true });
  await page.waitForURL(urlRe, { timeout: 10_000 });
  return Date.now() - t0;
};

await openScreen(page, activity, ORIGIN, 'seller', '/');
await page.waitForTimeout(6000);
await page.addStyleTag({ content: '#error-toast { display: none !important; pointer-events: none !important; }' }).catch(() => {});

await openWatchThreadsFromStudio(page);
await page.waitForTimeout(5000);
await shot('keep-01-watch-threads-with-seller-tab-bar');
const first = await currentPost(page);
check(await tabBarVisible(), 'seller tab bar is on screen over Watch Threads');

// Nothing in the feed's bottom chrome sits under the bar.
const overlap = await page.evaluate(() => {
  // The bar's Studio circle is as tall as its capsule, so its top is the bar's top.
  const studio = [...document.querySelectorAll('[aria-label="Open Studio tools"]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => b.top - a.top)[0];
  if (!studio) return { hits: ['no seller bar'] };
  const barTop = studio.top;
  const hits = [];
  for (const el of document.querySelectorAll('[aria-label^="Shop "], [aria-label^="Like"], [aria-label^="Comments"], [aria-label^="Save"], [aria-label="Share post"], [aria-label^="Sound:"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.top > innerHeight) continue;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!(top && (top === el || el.contains(top)))) continue; // not the visible feed page
    if (r.bottom > barTop) hits.push(`${el.getAttribute('aria-label')} bottom=${Math.round(r.bottom)} > barTop=${Math.round(barTop)}`);
  }
  return { barTop: Math.round(barTop), hits };
});
console.log('  bottom chrome vs tab bar:', JSON.stringify(overlap));
check(overlap.hits?.length === 0, 'rail, shop chip and sound disc all clear the seller tab bar');

await swipeUp(page, cdp);
await swipeUp(page, cdp);
await shot('keep-02-swiped-two-posts');
const kept = await currentPost(page);
check(!!kept && kept !== first, `swiped two posts (from "${first}" to "${kept}")`);

const msDash = await tapTab('Dashboard tab', (u) => new URL(u).pathname === '/');
await page.waitForTimeout(1500);
await shot('keep-03-dashboard-from-feed-tab-bar');
console.log(`  Dashboard tab → / in ${msDash}ms`);

await openWatchThreadsFromStudio(page);
await page.waitForTimeout(2500);
await shot('keep-04-reopened-same-post');
check((await currentPost(page)) === kept, `reopened Watch Threads on the same post ("${kept}")`);

const msProducts = await tapTab('Products tab', (u) => new URL(u).pathname === '/products');
await page.waitForTimeout(1500);
await shot('keep-05-products-from-feed-tab-bar');
console.log(`  Products tab → /products in ${msProducts}ms`);

// Back to the feed the way a seller would: the Studio card again.
await openWatchThreadsFromStudio(page);
await page.waitForTimeout(2500);
check((await currentPost(page)) === kept, 'still the same post after a trip to Products');
await page.getByLabel('Back').filter({ visible: true }).first().tap({ force: true });
await page.waitForTimeout(2500);
await shot('keep-06-back-control');
check(!/watch-threads/.test(page.url()), `Back left Watch Threads (now ${new URL(page.url()).pathname})`);

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
