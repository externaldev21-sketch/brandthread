#!/usr/bin/env node
/**
 * Discover loading fix — 390x844 captures: first load, mid-scroll, end of
 * list, and a fast-scroll frame sequence.
 *
 * Production web export + the store-screenshot fake API (signed-in buyer),
 * with the Discover data answered the way the REAL server answers it:
 *  - before: /api/public/trending enforces the real route's limit <= 50
 *    validation (400 otherwise — what the old "grow the limit" paging hit);
 *  - after: /api/public/discover is served page by page from a payload the
 *    real route produced against a seeded local Postgres (see the PR body).
 * Test harness only — nothing here ships in the app.
 *
 *   node scripts/discover-fix-capture.mjs <webBuildDir> <outDir> <before|after> [payload.json]
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const [buildDir, outDirArg, mode = 'after', payloadPath] = process.argv.slice(2);
const OUT = path.resolve(outDirArg);
mkdirSync(OUT, { recursive: true });
const pages = payloadPath ? JSON.parse(readFileSync(payloadPath, 'utf8')).afterBackfillPages : [];

async function installDiscoverApi(context) {
  const norm = (pathname) => pathname.replace(/^\/api\/v1/, '/api');
  await context.route((url) => url.origin === 'https://api.brandthread.test'
    && /^\/api\/public\/(discover|trending)$/.test(norm(url.pathname)), async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    if (norm(url.pathname) === '/api/public/trending' && Number(url.searchParams.get('limit') ?? 20) > 50) {
      return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"error":"Invalid trending query","code":"VALIDATION_ERROR"}' });
    }
    if (norm(url.pathname) === '/api/public/discover') {
      const cursor = url.searchParams.get('cursor');
      const page = pages.find((p) => (p.cursor ?? null) === (cursor ?? null));
      // A small network delay so the footer spinner is visible in the frames.
      await new Promise((r) => setTimeout(r, 450));
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(page ?? { items: [], nextCursor: null }) });
    }
    return route.fallback();
  });
}

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const { origin, close } = await serveBuild(path.resolve(buildDir));
try {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await installDiscoverApi(context);
  const settle = async (ms = 1200) => { await waitForQuietNetwork(activity, 600, 10_000).catch(() => {}); await page.waitForTimeout(ms); };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${mode}-${name}.png`) });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await openScreen(page, activity, origin, 'buyer', '/discover');
    await settle(2500);
    if (await page.getByText('Discover', { exact: true }).first().isVisible().catch(() => false)) break;
  }
  await shot('1-first-load');

  await page.mouse.move(195, 600);
  const scroll = async (dy, steps = 6) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await page.waitForTimeout(16); } };

  // Mid-scroll: a couple of screens down.
  await scroll(1500);
  await settle(900);
  await shot('2-mid-scroll');

  // Fast scroll frame sequence: hard flicks, a frame every ~120ms.
  for (let f = 0; f < 18; f++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, `${mode}-fast-scroll-${String(f).padStart(2, '0')}.png`) });
  }

  // End of list: keep flicking until nothing new loads.
  for (let i = 0; i < 25; i++) { await scroll(2000, 4); await page.waitForTimeout(500); }
  await settle(1500);
  await shot('3-end-of-list');
  await context.close();
} finally {
  await close();
  await browser.close();
}
