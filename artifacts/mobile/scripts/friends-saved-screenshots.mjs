#!/usr/bin/env node
/**
 * "3 friends saved this" — product page line, the "Saved by" sheet, and the
 * Privacy → "Show your saves" switch, at 393x852 on the store-screenshots
 * harness (signed-in demo buyer, fake API). GET /api/buyer/saved/friends/:id
 * and GET /api/auth/privacy are served here.
 *
 *   node scripts/friends-saved-screenshots.mjs --build <web export dir> --tag <before|after>
 *
 * Output: docs/pr-assets/friends-saved/<tag>-*.jpg
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
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/friends-saved');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PRODUCT = 'prod_nl_jacket_rust';
const FRIENDS = {
  count: 3,
  people: [
    { userId: 'u_maya', name: 'Maya Chen', handle: '@mayachen', initials: 'MC', avatarUrl: null },
    { userId: 'u_jordan', name: 'Jordan Lee', handle: '@jordanlee', initials: 'JL', avatarUrl: null },
    { userId: 'u_sam', name: 'Sam Ortiz', handle: '@samortiz', initials: 'SO', avatarUrl: null },
  ],
};

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  const serve = (match, body) => context.route((url) => match(url.pathname), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill(json(origin, body));
  });
  await serve((p) => p.includes('/buyer/saved/friends/'), FRIENDS);
  await serve((p) => p.endsWith('/auth/privacy'), { dmPrivacy: 'requests', isPrivate: false, canBePrivate: true, showSavesToFollowers: true });
  return { context, page, activity };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log('wrote', `${TAG}-${name}.jpg`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    {
      const { context, page, activity } = await setup(browser, images, server.origin);
      for (let attempt = 0; ; attempt++) {
        await openScreen(page, activity, server.origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
        try { await page.getByRole('radio', { name: /^Size, / }).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(800);
      // Scroll so the title, price and the new line sit mid-screen.
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="product-friends-saved"]') ?? document.querySelector('[role="radio"]');
        el?.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(400);
      await shot(page, 'pdp');
      const line = page.getByTestId('product-friends-saved');
      if (await line.count()) {
        await line.click();
        await page.getByTestId('product-friends-saved-sheet').waitFor({ timeout: 8000 });
        await page.waitForTimeout(900);
        await shot(page, 'pdp-sheet');
      }
      await context.close();
    }
    {
      const { context, page, activity } = await setup(browser, images, server.origin);
      // A client-side push to this screen bounces to Home in the preview; a
      // full load after the session is up keeps it.
      await openScreen(page, activity, server.origin, 'buyer', '/(buyer)');
      await page.waitForTimeout(1500);
      await page.goto(`${server.origin}/buyer-privacy-settings?bt_preview=buyer`);
      await page.getByText('Read receipts').first().waitFor({ timeout: 15_000 });
      await waitForQuietNetwork(activity); await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelector('[data-testid="privacy-show-saves"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await shot(page, 'privacy');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
