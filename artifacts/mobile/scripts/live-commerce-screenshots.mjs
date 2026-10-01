#!/usr/bin/env node
/**
 * 393x852 screenshots for the live-commerce PR (pinned product, live codes,
 * scheduled lives). Drives the preview web export through the shared store
 * screenshot harness (fake Clerk user + fake API). The schedule screen's own
 * endpoints are not part of the harness's demo data, so this script answers
 * /api/live/scheduled/* with a small in-script mock — screenshot-only.
 *
 *   node scripts/live-commerce-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude-live-commerce-pin-codes-schedule');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
}

async function open(browser, origin, role, target, { demo = false, mine = [] } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images: {} });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  const created = [...mine];
  await context.route('**/live/scheduled/**', async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ scheduled: created }) });
  });
  await openScreen(page, activity, origin, role, target, {
    beforeNavigate: async () => { if (demo) await page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')); },
  });
  await page.waitForTimeout(2000);
  const marker = target === '/seller-schedule-live' ? page.getByPlaceholder('Title') : page.getByTestId('live-screen');
  for (let i = 0; i < 4 && !(await marker.first().isVisible().catch(() => false)); i++) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}?bt_preview=${role}`);
    await page.waitForTimeout(2500);
  }
  return { context, page };
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    // 1. Schedule screen, empty form.
    let s = await open(browser, origin, 'seller', '/seller-schedule-live');
    await shot(s.page, '01-schedule-empty');
    await s.context.close();

    // 2. Filled form with a scheduled live listed (mocked list response).
    const startsAt = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
    s = await open(browser, origin, 'seller', '/seller-schedule-live', {
      mine: [{
        id: 'demo-1', sellerId: 'seller', title: 'Fall collection drop', description: null, startsAt,
        productTags: [], reminderCount: 12, reminderSet: false,
        seller: { name: 'Seller', username: null, avatarUrl: null, verified: false },
      }],
    });
    await s.page.getByPlaceholder('Title').fill('Winter capsule preview');
    await s.page.getByText('7:00 PM', { exact: true }).first().click().catch(() => {});
    await shot(s.page, '02-schedule-filled-with-list');
    await s.context.close();

    // 3. Viewer pager: pinned product card with Buy (demo preview streams).
    s = await open(browser, origin, 'buyer', '/live', { demo: true });
    await shot(s.page, '03-viewer-pinned-buy');
    await s.context.close();
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
