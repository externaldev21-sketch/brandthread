#!/usr/bin/env node
/**
 * Paid ad campaign delivery — screenshots at 390×844 (scale 2) on the
 * store-screenshots harness, with the new endpoints answered by a fake API:
 *
 *   buyer  01 Threads (For You) pager with a Sponsored page
 *   buyer  02 Following pager with a Sponsored page
 *   buyer  03 Discover grid with a Sponsored card
 *   seller 04 Marketing → Campaigns list (Active / Paused / Completed, spend of budget)
 *   seller 05 Campaign results screen (pause / stop, performance, placements)
 *
 * Also records whether the buyer client confirmed a viewable impression
 * (POST /api/ads/impression) for each feed.
 *
 *   node scripts/ad-delivery-screenshots.mjs [buildDir] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { IMAGE_HOST, respond } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'ads-web-build'));
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/ad-delivery'));
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const img = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;

function feedAd(surface, afterIndex, n) {
  return {
    afterIndex,
    token: `demo_token_${surface}_${n}_abcdefgh`,
    campaignId: `11111111-1111-4111-8111-11111111111${n}`,
    surface,
    label: 'Sponsored',
    headline: 'Heavyweight fleece, back in graphite',
    description: '480gsm brushed fleece. Free shipping this week.',
    mediaKind: 'photos',
    mediaUrls: [surface === 'discover' ? img('look-mono') : img('story-mono')],
    ctaKind: 'shop_now',
    ctaLabel: 'Shop now',
    destination: { kind: 'product', productId: 'prod_ea_hoodie_graphite', sellerId: 'user_demo_seller' },
    seller: { id: 'user_demo_seller', displayName: 'Ember Atelier', username: 'emberatelier', avatarUrl: img('portrait-mono') },
    product: { id: 'prod_ea_hoodie_graphite', name: 'Boxy Fleece Hoodie', imageUrl: img('hoodie-graphite'), priceCents: 8800 },
  };
}

const base = {
  sellerId: 'user_demo_seller', mediaKind: 'photos', mediaObjectPaths: ['/objects/a'], mediaMimeTypes: ['image/jpeg'],
  description: null, ctaKind: 'shop_now', ctaDestinationKind: 'product', ctaDestinationId: 'prod_ea_hoodie_graphite',
  formats: ['portrait_4x5'], estimatedReachLow: 0, estimatedReachHigh: 0, estimatedReach: { low: 0, high: 0, label: 'estimate' },
  stripeCheckoutSessionId: 'cs_demo', creativeConfig: null, surfaces: ['following', 'for_you', 'discover'],
  createdAt: '2026-09-10T18:00:00Z', updatedAt: '2026-09-18T18:00:00Z', pausedAt: null, completedAt: null, completionReason: null,
};
const CAMPAIGNS = [
  { ...base, id: 'c_active', headline: 'Heavyweight fleece, back in graphite', status: 'active', mediaUrls: [img('story-mono')], budgetCents: 10000, durationDays: 7, spentCents: 4218, impressionsCount: 2109, clicksCount: 87, paidAt: '2026-09-15T17:00:00Z', startsAt: '2026-09-15T17:00:00Z', endsAt: '2026-09-22T17:00:00Z',
    results: { impressions: 2109, uniqueReach: 1544, clicks: 87, ctrPercent: 4.13, spentCents: 4218, budgetCents: 10000, remainingCents: 5782 } },
  { ...base, id: 'c_paused', headline: 'Trail Runner 02 restock', status: 'paused', mediaUrls: [img('runner-stone')], budgetCents: 5000, durationDays: 5, spentCents: 1200, impressionsCount: 600, clicksCount: 19, paidAt: '2026-09-16T17:00:00Z', startsAt: '2026-09-16T17:00:00Z', endsAt: '2026-09-21T17:00:00Z', pausedAt: '2026-09-17T20:00:00Z',
    results: { impressions: 600, uniqueReach: 512, clicks: 19, ctrPercent: 3.17, spentCents: 1200, budgetCents: 5000, remainingCents: 3800 } },
  { ...base, id: 'c_done', headline: 'Drop 04 launch', status: 'completed', completionReason: 'budget_spent', mediaUrls: [img('story-rust')], budgetCents: 2500, durationDays: 3, spentCents: 2500, impressionsCount: 1250, clicksCount: 61, paidAt: '2026-09-11T17:00:00Z', startsAt: '2026-09-11T17:00:00Z', endsAt: '2026-09-14T17:00:00Z', completedAt: '2026-09-13T09:00:00Z',
    results: { impressions: 1250, uniqueReach: 1013, clicks: 61, ctrPercent: 4.88, spentCents: 2500, budgetCents: 2500, remainingCents: 0 } },
  { ...base, id: 'c_draft', headline: 'Bone colorway teaser', status: 'draft', mediaUrls: [], budgetCents: 2000, durationDays: 3, spentCents: 0, impressionsCount: 0, clicksCount: 0, paidAt: null, startsAt: null, endsAt: null, stripeCheckoutSessionId: null, results: { impressions: 0, uniqueReach: 0, clicks: 0, ctrPercent: 0, spentCents: 0, budgetCents: 2000, remainingCents: 2000 } },
];
const DAILY = [
  ['2026-09-15', 180, 6, 360], ['2026-09-16', 402, 15, 804], ['2026-09-17', 515, 22, 1030], ['2026-09-18', 1012, 44, 2024],
].map(([date, impressions, clicks, spendCents]) => ({ date, impressions, clicks, spendCents }));
const RESULTS = {
  ...CAMPAIGNS[0].results,
  bySurface: [
    { surface: 'following', impressions: 512, clicks: 17, spendCents: 1024 },
    { surface: 'for_you', impressions: 1133, clicks: 52, spendCents: 2266 },
    { surface: 'discover', impressions: 464, clicks: 18, spendCents: 928 },
  ],
  daily: DAILY,
  attribution: { windowDays: 7, orders: 6, revenueCents: 52800 },
};

async function routeAds(context, origin, log) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    // The demo feed has 8 posts (fewer once deduped); repeat them under new ids
    // so a real page has the >=6 organic items an ad needs.
    if ((p === '/api/public/posts' || p === '/api/posts/feed') && request.method() === 'GET') {
      if (Number(url.searchParams.get('offset') ?? 0) > 0) return json([]);
      const rows = respond({ method: 'GET', path: url.pathname, query: url.searchParams, role: 'buyer' }) ?? [];
      const tag = p === '/api/posts/feed' ? 'f' : 'g';
      return json([0, 1].flatMap((cycle) => rows.map((r) => ({ ...r, id: `${r.id}_${tag}${cycle}` }))));
    }
    if (p === '/api/ads/serve') {
      const surface = url.searchParams.get('surface');
      const offset = Number(url.searchParams.get('organicOffset'));
      const count = Number(url.searchParams.get('organicCount'));
      log.push(`serve ${surface} offset=${offset} count=${count}`);
      return json({ ads: offset === 0 && count >= 6 ? [feedAd(surface, 5, surface === 'following' ? 1 : surface === 'for_you' ? 2 : 3)] : [] });
    }
    if (p === '/api/ads/impression') { log.push(`impression ${request.postDataJSON()?.token}`); return json({ counted: true }); }
    if (p === '/api/ads/click') return json({ counted: true, destination: feedAd('for_you', 5, 2).destination });
    if (p === '/api/ad-campaigns') return json({ campaigns: CAMPAIGNS });
    if (p === '/api/ad-campaigns/c_active/results') return json({ campaign: CAMPAIGNS[0], results: RESULTS });
    return route.fallback();
  });
}

async function shot(page, name) {
  await waitForImages(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function scrollAdIntoView(page, testId) {
  for (let i = 0; i < 40; i += 1) {
    const found = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: 'start' });
      return true;
    }, testId);
    if (found) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const report = {};
  try {
    // ── Buyer ────────────────────────────────────────────────────────────────
    const buyerLog = [];
    async function buyerContext(target) {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
      await routeAds(context, server.origin, buyerLog);
      page.on('pageerror', (err) => buyerLog.push(`pageerror ${String(err?.stack ?? err).slice(0, 600)}`));
      page.setDefaultNavigationTimeout(240_000);
      await openScreen(page, activity, server.origin, 'buyer', target);
      await waitForQuietNetwork(activity, 900, 20_000);
      await page.waitForTimeout(1500);
      return { context, page, activity };
    }
    {
      const { context, page } = await buyerContext('/');
      report.forYouAd = await scrollAdIntoView(page, 'sponsored-ad-page');
      await page.waitForTimeout(1800);
      await shot(page, '01-threads-for-you-sponsored');
      await page.getByText('Following', { exact: true }).first().click();
      await page.waitForTimeout(2500);
      report.followingAd = await scrollAdIntoView(page, 'sponsored-ad-page');
      await page.waitForTimeout(1800);
      await shot(page, '02-following-sponsored');
      await context.close();
    }
    {
      const { context, page } = await buyerContext('/discover');
      report.discoverAd = await scrollAdIntoView(page, 'sponsored-ad-card');
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="sponsored-ad-card"]');
        let node = el?.parentElement;
        while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
        if (node && el) node.scrollTop -= 120;
      });
      for (let i = 0; i < 20 && !buyerLog.some((l) => l.startsWith('impression demo_token_discover')); i += 1) await page.waitForTimeout(250);
      await shot(page, '03-discover-sponsored');
      await context.close();
    }
    report.buyerApi = buyerLog.filter((l) => !l.startsWith('console'));
    console.log(JSON.stringify(report, null, 1));

    // ── Seller ───────────────────────────────────────────────────────────────
    {
      const log = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images });
      await routeAds(context, server.origin, log);
      page.setDefaultNavigationTimeout(240_000);
      await openScreen(page, activity, server.origin, 'seller', '/marketing');
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await page.getByText('Heavyweight fleece, back in graphite').first().waitFor({ timeout: 10_000 });
          break;
        } catch (err) {
          if (attempt === 5) throw err;
          // The app can remount its navigation tree once after sign-in and land back on "/".
          await page.evaluate(() => { history.pushState(history.state, '', '/marketing?bt_preview=seller'); dispatchEvent(new PopStateEvent('popstate')); });
        }
      }
      await waitForQuietNetwork(activity, 900, 15_000);
      await page.getByText('Campaigns', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Campaigns' && d.children.length === 0);
        let node = el?.parentElement;
        while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
        if (node) node.scrollTop -= 90;
      });
      await shot(page, '04-seller-campaign-list');

      await page.getByText('Heavyweight fleece, back in graphite').first().click();
      await page.getByText('Campaign results').first().waitFor({ timeout: 30_000 });
      await waitForQuietNetwork(activity, 900, 15_000);
      await page.waitForTimeout(800);
      await shot(page, '05-seller-campaign-results');
      await page.getByText('Placements', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(500);
      await shot(page, '06-seller-campaign-results-placements');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
