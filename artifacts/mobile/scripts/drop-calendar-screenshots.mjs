#!/usr/bin/env node
/**
 * Discover → Drops calendar — before (dev baseline: flat list) and after
 * (day-grouped calendar with notify bells), at 390x844 and 393x852, using the
 * store-screenshots harness (signed-in demo buyer) with fake
 * /api/public/drops?section=live|upcoming responses: one live drop, two
 * today, two tomorrow and two later days. Also captures the empty state
 * (both sections empty) and a bell turned on.
 *
 *   node scripts/drop-calendar-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Output: docs/pr-assets/drop-calendar/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { DEMO_NOW, PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/drop-calendar');
const BASELINE_DIR = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = [
  { tag: '390x844', viewport: { width: 390, height: 844 } },
  { tag: '393x852', viewport: { width: 393, height: 852 } },
];
const HOUR = 3_600_000;
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

// DEMO_NOW is Fri Sep 18 2026, 4:30 PM in America/Los_Angeles (the harness timezone).
const at = (iso) => new Date(iso).toISOString();
const image = (i) => PUBLIC_PRODUCTS[i % PUBLIC_PRODUCTS.length].images[0];
const seller = (brandName) => ({ brandName, displayName: brandName });
const row = (id, name, brand, releaseAt, img) => ({
  id, ownerId: `owner_${id}`, name, type: 'limited', status: 'active', releaseAt, endsAt: null,
  heroImageUrl: image(img), heroVideoUrl: null, launchTimezone: 'America/Los_Angeles',
  estimatedShipDate: null, orderCount: 0, mfgProgress: 0, createdAt: at(DEMO_NOW - 240 * HOUR), seller: seller(brand),
});
const LIVE = [row('drop_live_ember', 'Drop 04 — Ember Season', 'Northline', at(DEMO_NOW - 2 * HOUR), 0)];
const UPCOMING = [
  row('drop_today_runner', 'Trail Runner 02 Restock', 'Field Office', '2026-09-19T02:00:00Z', 1), // Fri 7:00 PM
  row('drop_today_tee', 'Heavyweight Tee — Bone', 'Quiet Hours', '2026-09-19T04:00:00Z', 2), // Fri 9:00 PM
  row('drop_tmrw_capsule', 'Loopback Capsule', 'Quiet Hours', '2026-09-19T17:00:00Z', 3), // Sat 10:00 AM
  row('drop_tmrw_cargo', 'Utility Cargo Pant', 'Northline', '2026-09-20T01:00:00Z', 4), // Sat 6:00 PM
  row('drop_tue_onyx', 'Onyx Outerwear', 'Ember Atelier', '2026-09-22T16:00:00Z', 5), // Tue 9:00 AM
  row('drop_thu_shell', 'Field Shell Jacket', 'Field Office', '2026-09-24T19:00:00Z', 6), // Thu 12:00 PM
];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin, viewport, { empty = false } = {}) {
  const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  const bells = new Map();
  await context.route((url) => url.pathname.endsWith('/public/drops'), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const section = new URL(route.request().url()).searchParams.get('section');
    if (empty) return route.fulfill(json(origin, []));
    if (section === 'live') return route.fulfill(json(origin, LIVE));
    if (section === 'upcoming') return route.fulfill(json(origin, UPCOMING));
    return route.fulfill(json(origin, [...LIVE, ...UPCOMING]));
  });
  await context.route((url) => /\/public\/drops\/[^/]+\/notify$/.test(url.pathname), (route) => {
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').slice(-2)[0];
    if (method === 'POST') bells.set(id, true);
    if (method === 'DELETE') bells.set(id, false);
    return route.fulfill(json(origin, { subscribed: !!bells.get(id) }));
  });
  return { context, page, activity };
}

async function openDrops(page, activity, origin) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/(buyer)/discover');
    try { await page.getByTestId('discover-filter-drops').first().waitFor({ timeout: 30_000 }); break; } catch (e) { await page.screenshot({ path: path.join(WORK_DIR, 'drop-calendar-fail.png') }); if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await page.getByTestId('discover-filter-drops').first().click();
  await page.waitForTimeout(1200);
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(600);
}

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const d of DEVICES) {
      {
        const { context, page, activity } = await setup(browser, images, server.origin, d.viewport);
        await openDrops(page, activity, server.origin);
        await page.screenshot({ path: path.join(OUT, `${label}-drops-${d.tag}.png`) });
        if (label === 'after') {
          // Scroll to the later days.
          await page.mouse.move(d.viewport.width / 2, d.viewport.height / 2);
          // Twice: the FlatList renders its next window after the first scroll.
          for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(800); }
          await waitForImages(page);
          await page.screenshot({ path: path.join(OUT, `${label}-drops-scrolled-${d.tag}.png`) });
          await page.mouse.wheel(0, -2000);
          await page.waitForTimeout(600);
          await page.getByTestId('drop-bell-drop_tmrw_capsule').first().click();
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(OUT, `${label}-drops-bell-on-${d.tag}.png`) });
        }
        await context.close();
      }
      {
        const { context, page, activity } = await setup(browser, images, server.origin, d.viewport, { empty: true });
        await openDrops(page, activity, server.origin);
        await page.screenshot({ path: path.join(OUT, `${label}-drops-empty-${d.tag}.png`) });
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (only !== 'after') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`Baseline build missing at ${BASELINE_DIR}`);
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
