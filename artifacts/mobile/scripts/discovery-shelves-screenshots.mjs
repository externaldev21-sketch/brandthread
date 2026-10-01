#!/usr/bin/env node
/**
 * Screenshots for buyer discovery (categories, trending, drops calendar) at
 * 393x852. The app runs the real exported web bundle; the demo harness answers
 * the general API, while the discovery + drops endpoints are proxied to a REAL
 * API server backed by a seeded Postgres (set DISCOVERY_API, e.g.
 * http://localhost:5055). Only the authenticated drop-alert endpoints are
 * stubbed (signed-out harness has no Clerk session).
 *
 *   DISCOVERY_API=http://localhost:5055 node scripts/discovery-shelves-screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { textFitCheck } from './textFitCheck.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const REAL_API = process.env.DISCOVERY_API ?? 'http://localhost:5055';
const DEMO_API = 'https://api.brandthread.test';
const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'buyer-discovery');
mkdirSync(OUT, { recursive: true });

const PROXIED = [
  /^\/public\/categories/, /^\/public\/trending\/(products|brands)/,
  /^\/public\/drops$/,
];

async function proxyToReal(page, origin) {
  const subscribed = new Set();
  await page.route(`${DEMO_API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (process.env.DEBUG_PROXY) console.log('proxy saw', req.method(), url.pathname);
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    const rel = url.pathname.replace(/^\/api(\/v1)?/, '');
    const notify = rel.match(/^\/public\/drops\/([^/]+)\/notify$/);
    if (notify) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'POST') subscribed.add(notify[1]);
      if (req.method() === 'DELETE') subscribed.delete(notify[1]);
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ subscribed: subscribed.has(notify[1]) }) });
    }
    if (PROXIED.some((re) => re.test(rel))) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const res = await fetch(`${REAL_API}/api${rel}${url.search}`);
      return route.fulfill({ status: res.status, headers: cors, contentType: 'application/json', body: await res.text() });
    }
    return route.fallback();
  });
}

const allProblems = [];
const shot = async (page, name) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const problems = await textFitCheck(page, { label: name });
  allProblems.push(...problems);
  console.log(`text-fit ${name}: ${problems.length === 0 ? 'clean' : JSON.stringify(problems)}`);
};

async function scrollUntilText(page, text) {
  for (let i = 0; i < 40; i += 1) {
    const el = page.getByText(text, { exact: true }).first();
    if (await el.isVisible().catch(() => false)) { await el.scrollIntoViewIfNeeded(); await page.mouse.wheel(0, 260); await page.waitForTimeout(400); return true; }
    await page.mouse.move(200, 500);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(250);
  }
  return false;
}

if (!process.env.SKIP_BUILD) buildPreviewWeb();
const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
try {
  const device = {
    viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await proxyToReal(page, origin);
  try {
    // Discover rails
    await openScreen(page, activity, origin, 'buyer', '/discover');
    await page.waitForTimeout(3000);
    if (await scrollUntilText(page, 'Trending products')) { await waitForImages(page); await page.waitForTimeout(500); await shot(page, '02-discover-trending-products'); }
    if (await scrollUntilText(page, 'Shop by category')) { await waitForImages(page); await page.waitForTimeout(500); await shot(page, '01-discover-shop-by-category'); }
    // Category page
    await openScreen(page, activity, origin, 'buyer', '/buyer-category?slug=hoodies&label=Hoodies');
    await page.getByText('Heavyweight Hoodie').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await waitForImages(page); await waitForQuietNetwork(activity, 600, 8000);
    await shot(page, '03-category-hoodies');
    // Trending see-all
    await openScreen(page, activity, origin, 'buyer', '/buyer-trending?type=products');
    await page.getByText('Heavyweight Hoodie').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await waitForImages(page); await shot(page, '04-trending-products-see-all');
    await openScreen(page, activity, origin, 'buyer', '/buyer-trending?type=brands');
    await page.getByText('Ember & Ash').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await waitForImages(page); await shot(page, '05-trending-brands-see-all');
    // Drops calendar
    await openScreen(page, activity, origin, 'buyer', '/buyer-drops');
    await page.getByText('Upcoming', { exact: true }).first().click({ timeout: 20_000 });
    await page.getByText('Calendar', { exact: true }).first().click({ timeout: 10_000 });
    await page.getByText('Autumn Capsule').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await waitForImages(page); await shot(page, '06-drops-calendar');
    await page.getByTestId('drop-bell-10000000-0000-4000-8000-000000000001').click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, '07-drops-calendar-notify-on');
    await page.screenshot({ path: path.join(OUT, '07z-calendar-rows-zoom.png'), clip: { x: 0, y: 190, width: 393, height: 300 } });
    // Search
    await openScreen(page, activity, origin, 'buyer', '/buyer-search');
    await page.getByTestId('buyer-search-field').click().catch(() => {});
    await page.getByText('Shop by category').first().waitFor({ timeout: 15_000 }).catch(() => {});
    await waitForImages(page); await shot(page, '08-search-shop-by-category');
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
  close();
}
console.log(`Screenshots written to ${OUT}; text-fit problems: ${allProblems.length}`);
