#!/usr/bin/env node
/**
 * Watch Threads vs the plain buyer Threads feed, same post, 390×844.
 * Writes <outDir>/<prefix>buyer-home.png and <prefix>seller-watch-threads.png
 * and prints every on-screen accessibility label each one has that the other
 * does not, so any chrome Watch Threads adds (beyond Back) shows up by name.
 * Each opens the feed the way a person does: buyer Home is the app's start
 * screen; the seller taps Studio → Watch Threads.
 *
 *   node scripts/store-screenshots/watch-threads-compare.mjs [origin] [outDir] [prefix]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { openWatchThreadsFromStudio, serveFeedToSeller } from './watch-threads-helpers.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/watch-threads-v2'));
const PREFIX = process.argv[4] ?? '';
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };

async function capture(role, target, name) {
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  await serveFeedToSeller(context);
  page.setDefaultNavigationTimeout(300_000);
  await openScreen(page, activity, ORIGIN, role, '/');
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '#error-toast { display: none !important; pointer-events: none !important; }' }).catch(() => {});
  if (target) await target(page);
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '#error-toast { display: none !important; }' }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}${name}.png`) });
  const labels = await page.$$eval('[aria-label]', (els) => els.filter((e) => {
    // On screen AND the topmost thing at its own centre — retained tabs keep
    // other screens mounted underneath, which must not count.
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)));
    return !!top && (top === e || e.contains(top) || top.contains(e));
  }).map((e) => e.getAttribute('aria-label')));
  console.log(`  ✓ ${name}  ${new URL(page.url()).pathname}`);
  if (process.env.DEBUG) console.log(JSON.stringify(labels));
  await context.close();
  return new Set(labels);
}

const buyer = await capture('buyer', null, 'buyer-home');
const seller = await capture('seller', openWatchThreadsFromStudio, 'seller-watch-threads');
console.log('only on Watch Threads:', JSON.stringify([...seller].filter((l) => !buyer.has(l))));
console.log('only on buyer Home:   ', JSON.stringify([...buyer].filter((l) => !seller.has(l))));
await browser.close();
