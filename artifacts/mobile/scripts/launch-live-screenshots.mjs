#!/usr/bin/env node
/**
 * Hands-on QA + screenshots for the LIVE launch (branch claude/launch-live),
 * at 390x844. Drives the preview web export through the shared store
 * screenshot harness (fake Clerk user + fake API) and taps through every
 * step: the LIVE grid, joining a show, the first-show agreement, Shop, More,
 * hearts, chat; the seller's Create your show, camera check (Chromium's
 * fake camera), live controls with pin / unpin, End show and the summary;
 * plus the "LIVE isn't available yet" state when the server has no Agora key.
 *
 * Shows in the grid / viewer are the bundled preview shows, which only exist
 * under `demo=1` (same opt-in as every preview dataset). /api/live/status and
 * the summary endpoint are answered here, in-script, screenshot-only.
 *
 *   node scripts/launch-live-screenshots.mjs [--skip-build] [--out <dir>] [--before]
 *
 * `--before` runs the same walk against an older build and only captures the
 * screens that existed there.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { respond } from './store-screenshots/demo-data.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const BEFORE = flag('--before');
const BUILD_DIR = opt('--build', DEFAULT_BUILD_DIR);
const OUT = path.resolve(opt('--out', path.resolve(MOBILE_ROOT, '../../docs/screenshots/claude-launch-live/after')));
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const problems = [];

async function shot(page, name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
}

async function tap(page, testId, { optional = false, timeout = 6000 } = {}) {
  const el = page.getByTestId(testId).first();
  try {
    await el.waitFor({ state: 'visible', timeout });
    await el.click();
    return true;
  } catch (e) {
    if (!optional) problems.push(`could not tap ${testId}: ${String(e.message).split('\n')[0]}`);
    return false;
  }
}

async function visible(page, testId, timeout = 8000) {
  const ids = Array.isArray(testId) ? testId : [testId];
  const sel = ids.map((id) => `[data-testid="${id}"]`).join(',');
  return page.locator(sel).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
}

async function open(browser, origin, images, role, target, { demo = false, configured = true, summary = null, adult = false } = {}) {
  const device = { viewport: VIEWPORT, scale: 1, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  page.on('pageerror', (e) => problems.push(`[pageerror ${target}] ${e.message.slice(0, 160)}`));
  await context.grantPermissions(['camera', 'microphone']).catch(() => {});
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const json = (route, body) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) }));
  await context.route('**/api/**live/status', (route) => json(route, configured
    ? { streaming: { available: true, code: null }, replays: { available: false, code: 'REPLAYS_NOT_CONFIGURED' } }
    : { streaming: { available: false, code: 'LIVE_NOT_CONFIGURED' }, replays: { available: false, code: 'REPLAYS_NOT_CONFIGURED' } }));
  // An adult account, so go-live's age check passes in a buyer-role session.
  if (adult) await context.route('**/api/**auth/me', (route) => json(route, { ...respond({ method: 'GET', path: '/api/auth/me', role }), ageBand: '18_plus' }));
  if (summary) await context.route('**/api/**live/*/summary', (route) => json(route, { summary }));
  await openScreen(page, activity, origin, role, target, {
    extraQuery: demo ? '&demo=1' : '',
    beforeNavigate: async () => { if (demo) await page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')); },
  });
  await page.waitForTimeout(2500);
  // The first client-side push can land before the router has settled
  // (heavier with demo=1); retry until the target screen is on top.
  const marker = MARKERS[target.split('?')[0]];
  for (let i = 0; marker && i < 5 && !(await visible(page, marker, 1500)); i++) {
    const url = `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}${demo ? '&demo=1' : ''}`;
    await page.evaluate((u) => {
      history.pushState(history.state, '', u);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, url);
    await page.waitForTimeout(2000);
  }
  if (marker && !(await visible(page, marker, 1000))) problems.push(`${target} never opened (${marker} missing)`);
  return { context, page };
}

const MARKERS = {
  '/live-feed': 'live-feed-screen',
  '/live': 'live-screen',
  '/seller-go-live': ['go-live-setup', 'go-live-not-configured'],
  '/seller-live-summary': 'seller-live-summary',
};

async function buyer(browser, origin, images) {
  console.log('Buyer');
  // LIVE tab content, no Agora key on the server.
  let { context, page } = await open(browser, origin, images, 'buyer', '/live-feed', { configured: false });
  await shot(page, 'b01-live-grid-not-configured');
  await context.close();

  // A show link with no key.
  ({ context, page } = await open(browser, origin, images, 'buyer', '/live', { configured: false }));
  await shot(page, 'b02-show-not-configured');
  await context.close();

  // Configured, nobody live (fresh preview, no demo=1 → no seeded shows).
  ({ context, page } = await open(browser, origin, images, 'buyer', '/live-feed'));
  await shot(page, 'b03-live-grid-empty');
  await context.close();

  // Configured with shows (demo=1 preview shows).
  ({ context, page } = await open(browser, origin, images, 'buyer', '/live-feed', { demo: true }));
  await shot(page, 'b04-live-grid');
  if (BEFORE) { await context.close(); return; }
  const firstCard = page.locator('[data-testid^="live-show-"]').first();
  if (await firstCard.isVisible().catch(() => false)) await firstCard.click();
  else problems.push('no show card in the LIVE grid');
  await page.waitForTimeout(2500);
  if (await visible(page, 'live-buyer-agreement')) await shot(page, 'b05-first-show-agreement');
  else problems.push('first-show agreement did not appear');
  await tap(page, 'live-agreement-agree');
  await page.waitForTimeout(1500);
  await shot(page, 'b06-show-viewer');
  // Hearts: tap the video twice.
  await page.mouse.click(200, 380);
  await page.mouse.click(210, 400);
  await page.waitForTimeout(250);
  await shot(page, 'b07-show-hearts');
  // Chat
  const input = page.getByTestId('live-comment-input').first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill('Is the hoodie true to size?');
    await shot(page, 'b08-show-typing');
    await input.press('Enter');
    await page.waitForTimeout(800);
    await shot(page, 'b09-show-chat-sent');
  } else problems.push('chat input missing');
  // Follow
  await tap(page, 'live-follow');
  await page.waitForTimeout(500);
  await shot(page, 'b10-show-following');
  // Shop
  await tap(page, 'live-bag');
  if (await visible(page, 'live-products-sheet')) await shot(page, 'b11-shop-sheet');
  await tap(page, 'live-shop-close', { optional: true });
  await page.waitForTimeout(600);
  // Buy now on the pinned item
  if (await tap(page, 'live-buy', { optional: true })) {
    await page.waitForTimeout(1500);
    await shot(page, 'b12-buy-now-sheet');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  // More
  await tap(page, 'live-more');
  if (await visible(page, 'live-stream-options-sheet')) await shot(page, 'b13-more-sheet');
  await page.keyboard.press('Escape');
  await page.mouse.click(195, 120);
  await page.waitForTimeout(600);
  // Swipe to the next show
  await page.mouse.move(195, 600);
  await page.mouse.wheel(0, 844);
  await page.waitForTimeout(1800);
  await shot(page, 'b14-next-show');
  await context.close();
}

async function seller(browser, origin, images) {
  console.log('Seller');
  // The signed-out seller preview blocks every API call by design, so the
  // status check (and its "not set up" answer) runs in a session whose API
  // is reachable; the screen itself doesn't depend on the role.
  let { context, page } = await open(browser, origin, images, 'buyer', '/seller-go-live', { configured: false, adult: true });
  await shot(page, 's01-go-live-not-configured');
  await context.close();

  ({ context, page } = await open(browser, origin, images, 'seller', '/seller-go-live', { demo: true }));
  await shot(page, 's02-create-show');
  if (BEFORE) { await context.close(); return; }
  const title = page.getByTestId('go-live-title').first();
  if (await title.isVisible().catch(() => false)) await title.fill('Ember Season restock — hoodies + jackets');
  else problems.push('title field missing');
  await tap(page, 'go-live-thumbnail');
  await page.waitForTimeout(700);
  await shot(page, 's03-add-photos-sheet');
  // The sheet's own Cancel row (the footer has a Cancel too).
  await page.getByRole('button', { name: 'Cancel' }).last().click().catch(() => {});
  await page.waitForTimeout(700);
  await tap(page, 'go-live-add-products');
  if (await visible(page, 'live-products-sheet')) {
    await page.waitForTimeout(1500);
    const add = page.locator('[data-testid^="live-shop-action-"]');
    const count = Math.min(await add.count(), 2);
    for (let i = 0; i < count; i++) { await add.nth(i).click(); await page.waitForTimeout(200); }
    await shot(page, 's04-pick-products');
    await tap(page, 'live-shop-close');
  } else problems.push('product picker did not open');
  await page.waitForTimeout(600);
  await shot(page, 's05-create-show-filled');
  await tap(page, 'go-live-next');
  await page.waitForTimeout(2500);
  await shot(page, 's06-camera-check');
  await tap(page, 'go-live-flip');
  await tap(page, 'go-live-mic');
  await page.waitForTimeout(400);
  await shot(page, 's07-camera-check-flipped-mic-off');
  await tap(page, 'go-live-mic');
  await tap(page, 'go-live-shop');
  if (await visible(page, 'live-products-sheet')) await shot(page, 's08-camera-check-shop');
  await tap(page, 'live-shop-close', { optional: true });
  await page.waitForTimeout(500);
  await tap(page, 'go-live-start');
  await page.waitForTimeout(3500);
  await shot(page, 's09-live-controls');
  await tap(page, 'live-bag');
  if (await visible(page, 'live-products-sheet')) {
    await shot(page, 's10-host-shop');
    const pin = page.locator('[data-testid^="live-shop-action-"]').first();
    await pin.click().catch(() => problems.push('pin button missing'));
  }
  await page.waitForTimeout(1200);
  await shot(page, 's11-live-controls-pinned');
  await tap(page, 'live-more');
  await page.waitForTimeout(600);
  await shot(page, 's12-host-more');
  await page.getByText('Cancel', { exact: true }).last().click().catch(() => {});
  await page.waitForTimeout(500);
  await tap(page, 'seller-live-unpin', { optional: true });
  await page.waitForTimeout(500);
  await tap(page, 'live-close');
  await page.waitForTimeout(700);
  await shot(page, 's13-end-show-confirm');
  await page.getByText('End show', { exact: true }).last().click().catch(() => problems.push('End show button missing'));
  await page.waitForTimeout(2500);
  await shot(page, 's14-summary-preview');
  await context.close();

  // The summary with the server's numbers (buyer-role session so the fake
  // API is reachable; the screen itself doesn't depend on role).
  ({ context, page } = await open(browser, origin, images, 'buyer', '/seller-live-summary?streamId=11111111-1111-4111-8111-111111111111&title=Ember%20Season%20restock', {
    summary: { id: '11111111-1111-4111-8111-111111111111', title: 'Ember Season restock — hoodies + jackets', status: 'ended', durationSeconds: 2550, peakViewers: 37, totalViewers: 112, comments: 58, productsShown: 4 },
  }));
  await shot(page, 's15-summary');
  await context.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!flag('--skip-build') && !BEFORE) buildPreviewWeb(BUILD_DIR);
  if (!existsSync(path.join(BUILD_DIR, 'index.html'))) throw new Error(`No web build at ${BUILD_DIR}`);
  const server = await serveBuild(BUILD_DIR);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
    await buyer(browser, server.origin, images);
    await seller(browser, server.origin, images);
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) {
    console.log(`\n${problems.length} QA problem(s):`);
    for (const p of [...new Set(problems)]) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nQA walk finished with no problems.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
