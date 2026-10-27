#!/usr/bin/env node
/**
 * Create Ad — hands-on verification at 390×844 (scale 2) on the
 * store-screenshots harness. Ad endpoints (/api/ad-campaigns*, /api/ads/*)
 * are forwarded to a REAL ad engine (VERIFY_API, e.g. the api-server routers
 * over a dev DB seeded with `pnpm --filter @workspace/api-server run
 * seed:demo-ad-campaign`), acting as the seeded seller or a buyer via the
 * x-verify-user header; everything else uses the harness's demo data.
 *
 *   seller 01/02  Create Ad — swipe to $130/day, then 2 days vs 25 days (one reach card)
 *   seller 03     Reach readings while swiping days 1 → 30 (printed to stdout)
 *   buyer  04     For You pager: the engine serves the Sponsored page after 6 posts
 *   seller 05/06  Marketing → campaign → its results; live polling while delivery trickles in
 *
 *   demo   09/10  `&demo=1` preview (no backend): the demo campaign trickling, and its Sponsored page
 *
 *   VERIFY_API=http://127.0.0.1:5077 node scripts/create-ad-screenshots.mjs [buildDir] [outDir]
 *   ONLY_DEMO=1 node scripts/create-ad-screenshots.mjs     (demo preview only; no engine needed)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { respond } from './store-screenshots/demo-data.mjs';
import { MOBILE_ROOT, launchBrowser as harnessBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'ads-web-build'));
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/create-ad'));
const VERIFY_API = process.env.VERIFY_API ?? 'http://127.0.0.1:5077';
const SELLER_ID = process.env.VERIFY_SELLER ?? 'demo-ad-seller';
// A fresh buyer each run: the engine caps any one buyer at 3 serves of a campaign a day.
const BUYER_ID = process.env.VERIFY_BUYER ?? `screenshot-buyer-${Date.now()}`;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };

// Daily-budget slider stops (services/adCampaignService.ts BUDGET_STEPS).
const BUDGET_STEPS = [
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 5),
  ...Array.from({ length: 15 }, (_, i) => 60 + i * 10),
  ...Array.from({ length: 12 }, (_, i) => 225 + i * 25),
  ...Array.from({ length: 10 }, (_, i) => 550 + i * 50),
];

async function forwardAds(context, origin, userId, log) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    // The demo feed has 5 posts; repeat them under new ids so a page has the
    // >= 6 organic items the engine needs before its first Sponsored slot.
    if ((p === '/api/public/posts' || p === '/api/posts/feed') && request.method() === 'GET') {
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
      if (Number(url.searchParams.get('offset') ?? 0) > 0) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
      const rows = respond({ method: 'GET', path: url.pathname, query: url.searchParams, role: 'buyer' }) ?? [];
      const tag = p === '/api/posts/feed' ? 'f' : 'g';
      const body = JSON.stringify([0, 1].flatMap((cycle) => rows.map((r) => ({ ...r, id: `${r.id}_${tag}${cycle}` }))));
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body });
    }
    if (!p.startsWith('/api/ad-campaigns') && !p.startsWith('/api/ads/')) return route.fallback();
    const res = await fetch(`${VERIFY_API}${p}${url.search}`, {
      method: request.method(),
      headers: { 'content-type': 'application/json', 'x-verify-user': userId },
      body: ['POST', 'PATCH'].includes(request.method()) ? request.postData() ?? undefined : undefined,
    });
    const body = await res.text();
    log.push(`${request.method()} ${p}${p === '/api/ads/serve' ? url.search : ''} → ${res.status}${p === '/api/ads/serve' ? ` ads=${JSON.parse(body).ads?.length}` : ''}`);
    return route.fulfill({
      status: res.status,
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      contentType: 'application/json',
      body,
    });
  });
}

async function shot(page, name) {
  await waitForImages(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

/**
 * A real finger swipe (CDP touch events) from the slider's thumb to `fraction`
 * of its width. (Starting at the screen edge would trigger the app's
 * swipe-back gesture instead, as it would for a real finger.)
 */
async function swipeSlider(page, label, fraction) {
  const slider = page.locator(`[aria-label="${label}"]`).first();
  await slider.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const box = await slider.boundingBox();
  if (!box) throw new Error(`slider ${label} not found`);
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const now = await slider.evaluate((el) => {
    const v = (k) => Number(el.getAttribute(`aria-value${k}`));
    return { now: v('now'), min: v('min'), max: v('max') };
  });
  const steps = label === 'Daily budget' ? BUDGET_STEPS.map((d) => d * 100) : null;
  const fromFraction = steps
    ? Math.max(0, steps.indexOf(now.now)) / (steps.length - 1)
    : (now.now - now.min) / Math.max(1, now.max - now.min);
  const from = box.x + Math.max(12, fromFraction * box.width);
  const to = box.x + Math.max(1, Math.min(box.width - 1, fraction * box.width));
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', from);
  const moves = Math.max(12, Math.round(Math.abs(to - from) / 6));
  for (let i = 1; i <= moves; i += 1) { await touch('touchMove', from + ((to - from) * i) / moves); await page.waitForTimeout(16); }
  await touch('touchEnd', to);
  await page.waitForTimeout(250);
}

/** PLAYWRIGHT_CHROMIUM_PATH points at a preinstalled Chromium when the pinned one isn't installed. */
async function launchBrowser() {
  if (!process.env.PLAYWRIGHT_CHROMIUM_PATH) return harnessBrowser();
  const { chromium } = await import('playwright');
  return chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
}

/** The app can remount its navigation tree once after sign-in and land back on "/": re-push until `ready` shows. */
async function settleOn(page, target, role, ready) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await ready.waitFor({ timeout: 10_000 });
      return;
    } catch (err) {
      if (attempt === 5) {
        await page.screenshot({ path: path.join(OUT, `_debug-${target.replace(/\W+/g, '')}.png`) });
        throw err;
      }
      await page.evaluate(([t, r]) => {
        history.pushState(history.state, '', `${t}${t.includes('?') ? '&' : '?'}bt_preview=${r}`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, [target, role]);
    }
  }
}

const text = (page, id) => page.locator(`[data-testid="${id}"]`).first().innerText();

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const report = {};
  try {
    if (!process.env.ONLY_DEMO) {
    // ── Seller: Create Ad sliders ─────────────────────────────────────────────
    {
      const log = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images, installClock: false });
      await forwardAds(context, server.origin, SELLER_ID, log);
      page.setDefaultNavigationTimeout(240_000);
      await openScreen(page, activity, server.origin, 'seller', '/design-campaign');
      await settleOn(page, '/design-campaign', 'seller', page.locator('[aria-label="Daily budget"]').first());
      // Let the post-sign-in remount happen before touching anything, then re-settle.
      await page.waitForTimeout(20_000);
      await settleOn(page, '/design-campaign', 'seller', page.locator('[aria-label="Daily budget"]').first());
      await page.locator('[data-testid="estimated-reach"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(500);

      await swipeSlider(page, 'Daily budget', BUDGET_STEPS.indexOf(130) / (BUDGET_STEPS.length - 1));
      await swipeSlider(page, 'Campaign duration', (2 - 1) / 29);
      report.twoDays = { daily: await text(page, 'daily-budget-value'), days: await text(page, 'duration-value'), total: await text(page, 'campaign-total'), reach: await text(page, 'estimated-reach-range') };
      await page.locator('[data-testid="daily-budget-value"]').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, '01-create-ad-130-per-day-2-days');

      await swipeSlider(page, 'Campaign duration', (25 - 1) / 29);
      await page.locator('[data-testid="daily-budget-value"]').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      report.twentyFiveDays = { daily: await text(page, 'daily-budget-value'), days: await text(page, 'duration-value'), total: await text(page, 'campaign-total'), reach: await text(page, 'estimated-reach-range') };
      await shot(page, '02-create-ad-130-per-day-25-days');

      report.reachByDays = [];
      for (const d of [1, 2, 3, 5, 7, 10, 14, 20, 25, 30]) {
        await swipeSlider(page, 'Campaign duration', (d - 1) / 29);
        report.reachByDays.push(`${await text(page, 'duration-value')}: ${await text(page, 'estimated-reach-range')}`);
      }
      report.reachCards = await page.locator('text=Who this will reach').count();
      report.sellerApi = log;
      await context.close();
    }

    // ── Buyer: For You with the engine's Sponsored slot ────────────────────────
    {
      const log = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images, installClock: false });
      await forwardAds(context, server.origin, BUYER_ID, log);
      page.on('pageerror', (err) => log.push(`pageerror ${String(err?.stack ?? err).slice(0, 900)}`));
      page.on('console', (m) => {
        const t = m.text();
        if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(t)) log.push(`console ${t.slice(0, 1500)}`);
      });
      page.setDefaultNavigationTimeout(240_000);
      await openScreen(page, activity, server.origin, 'buyer', '/');
      await waitForQuietNetwork(activity, 900, 20_000);
      // Page down the vertical pager like a finger would until the Sponsored page renders.
      let found = false;
      for (let i = 0; i < 24 && !found; i += 1) {
        found = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="sponsored-ad-page"]');
          el?.scrollIntoView({ block: 'start' });
          return !!el;
        });
        if (!found) {
          await page.mouse.move(195, 420);
          await page.mouse.wheel(0, 844);
          await page.waitForTimeout(700);
        }
      }
      report.buyerSponsored = found;
      await page.waitForTimeout(2200); // >= 1s at >= 50% visible → impression confirmed
      await shot(page, '04-buyer-for-you-sponsored');
      report.buyerApi = log;
      await context.close();
    }

    // ── Seller: Marketing → campaign → live results ───────────────────────────
    // Other buyers keep opening their feeds meanwhile (fresh viewers, serve →
    // viewable impression), so the paced delivery keeps trickling in.
    let viewerN = 0;
    const traffic = setInterval(async () => {
      const viewer = `screenshot-traffic-${Date.now()}-${viewerN++}`;
      const headers = { 'x-verify-user': viewer, 'content-type': 'application/json' };
      try {
        const r = await fetch(`${VERIFY_API}/api/ads/serve?surface=for_you&sessionId=shot${Date.now()}&organicOffset=0&organicCount=6`, { headers }).then((x) => x.json());
        for (const ad of r.ads ?? []) await fetch(`${VERIFY_API}/api/ads/impression`, { method: 'POST', headers, body: JSON.stringify({ token: ad.token }) });
      } catch { /* best effort */ }
    }, 400);
    {
      const log = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images, installClock: false });
      await forwardAds(context, server.origin, SELLER_ID, log);
      page.setDefaultNavigationTimeout(240_000);
      await openScreen(page, activity, server.origin, 'seller', '/marketing');
      await settleOn(page, '/marketing', 'seller', page.getByText('The winter edit is here').first());
      await waitForQuietNetwork(activity, 900, 15_000);
      await page.getByText('The winter edit is here').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(page, '05-marketing-campaigns');
      await page.getByText('The winter edit is here').first().click();
      await page.locator('[data-testid="pacing-status"]').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      const campaignId = new URL(page.url()).searchParams.get('campaignId');
      const read = async () => {
        const r = await fetch(`${VERIFY_API}/api/ad-campaigns/${campaignId}/results`, { headers: { 'x-verify-user': SELLER_ID } }).then((x) => x.json());
        return { impressions: r.results.impressions, spentCents: r.results.spentCents, pacing: r.results.pacing.status, onScreen: await page.evaluate(() => document.body.innerText.match(/Spent\s*\n?\s*(\$[\d.,]+)/)?.[1] ?? '?') };
      };
      report.resultsUrl = page.url();
      report.impressionsAtOpen = await read();
      await shot(page, '06-campaign-results-live');
      await page.waitForTimeout(45_000); // two 20s polls while traffic keeps flowing
      report.impressionsAfter45s = await read();
      await page.getByText('Delivery', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, '07-campaign-results-pacing');
      await page.getByText('Performance', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot(page, '08-campaign-results-hourly');
      report.resultsApi = log.filter((l) => l.includes('/results')).length;
      await context.close();
    }
    clearInterval(traffic);

    }
    // ── Demo preview (&demo=1, no backend): lib/demoAdCampaign.ts ────────────
    if (!process.env.SKIP_DEMO) {
      {
        const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images, installClock: false });
        page.setDefaultNavigationTimeout(240_000);
        await openScreen(page, activity, server.origin, 'seller', '/ad-campaign-results?campaignId=demo-ad-campaign', { extraQuery: '&demo=1' });
        await settleOn(page, '/ad-campaign-results?campaignId=demo-ad-campaign&demo=1', 'seller', page.locator('[data-testid="pacing-status"]').first());
        const spent = () => page.evaluate(() => document.body.innerText.match(/Spent\s*\n?\s*(\$[\d.,]+)/)?.[1] ?? '?');
        report.demoSpentAtOpen = await spent();
        await shot(page, '09-demo-campaign-results');
        await page.waitForTimeout(40_000); // demo re-reads every 5s; ~$5.42/hour ≈ one 2¢ impression every 13s
        report.demoSpentAfter40s = await spent();
        await context.close();
      }
      {
        const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images, installClock: false });
        // Only the feed padding is used here: in demo mode the app never calls the ads API.
        await forwardAds(context, server.origin, BUYER_ID, []);
        page.setDefaultNavigationTimeout(240_000);
        await openScreen(page, activity, server.origin, 'buyer', '/', { extraQuery: '&demo=1' });
        // After the post-sign-in remount, put the demo flag back on the URL and reload once.
        await page.waitForTimeout(15_000);
        await page.goto(`${server.origin}/?bt_preview=buyer&demo=1`);
        await waitForQuietNetwork(activity, 900, 20_000);
        await page.waitForTimeout(3_000);
        let found = false;
        for (let i = 0; i < 24 && !found; i += 1) {
          found = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="sponsored-ad-page"]');
            el?.scrollIntoView({ block: 'start' });
            return !!el;
          });
          if (!found) { await page.mouse.move(195, 420); await page.mouse.wheel(0, 844); await page.waitForTimeout(700); }
        }
        report.demoBuyerSponsored = found;
        await page.waitForTimeout(1500);
        await shot(page, '10-demo-buyer-sponsored');
        await context.close();
      }
    }
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await browser.close();
    await server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
