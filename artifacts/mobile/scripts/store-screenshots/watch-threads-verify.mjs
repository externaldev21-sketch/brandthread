#!/usr/bin/env node
/**
 * Watch Threads: the seller Studio menu's first card into the real Threads
 * feed, and the whole buyer path from there, as a signed-in SELLER account.
 *
 * 390×844 on the dev bundle (`expo start --web` with the harness env — see
 * harness.mjs buildPreviewWeb). Screenshot at each step:
 *   01 dashboard → 02 Studio menu open, first card "Watch Threads" →
 *   03 feed open (seller context kept, Back control) → 04 swiped to the next
 *   post → 05 comments → 06 shop chip → product page → 07 added to bag →
 *   08 Bag (root stack, no buyer tab bar) → 09 checkout → 10 back to the
 *   seller dashboard.
 *
 * Start the dev server with the harness env plus
 * EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_demo (so checkout is live in test mode), then
 *   node scripts/store-screenshots/watch-threads-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { respond } from './demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/watch-threads'));
const STEP = process.env.STEP ?? 'all';
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images, seedOptions: {} });
// The fake API only seeds the Threads feed for its buyer account; the real
// GET /api/posts/feed serves any signed-in account (see
// api-server seller-as-buyer.integration.test.ts), so give the seller the
// same posts here.
await context.route((url) => url.origin === 'https://api.brandthread.test' && /^\/api(\/v1)?\/(posts\/feed|public\/posts)\/?$/.test(url.pathname), (route) => {
  const req = route.request();
  const cors = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,OPTIONS' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const url = new URL(req.url());
  activity.lastApiAt = Date.now();
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(respond({ method: 'GET', path: url.pathname, query: url.searchParams, role: 'buyer' })) });
});
// The fake API has no checkout fixtures (every POST answers {ok:true}, and
// seller-payment-status 404s). Answer them the way the real routes do for a
// seller account (seller-as-buyer.integration.test.ts drives those for real).
const stub = (pattern, body) => context.route((url) => url.origin === 'https://api.brandthread.test' && pattern.test(url.pathname), (route) => {
  const req = route.request();
  const cors = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(typeof body === 'function' ? body(req) : body) });
});
await stub(/\/buyer\/cart\/validate$/, { isValid: true, issues: [] });
await stub(/\/buyer\/seller-payment-status\//, { ready: true });
// Checkout live in Stripe test mode (needs EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_demo
// in the bundle, as launch-checkout-capture.mjs does); js.stripe.com stays offline.
await stub(/\/public\/checkout-config$/, { live: true, mode: 'test', applePay: false, googlePay: false, reason: null });
page.setDefaultNavigationTimeout(300_000);
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
if (process.env.DEBUG) page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 600)); });
const cdp = await page.context().newCDPSession(page);

const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log(`  ✓ ${name}  ${new URL(page.url()).pathname}`); };
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const tap = async (x, y) => { await touch('touchStart', x, y); await page.waitForTimeout(40); await touch('touchEnd', x, y); };
const swipe = async (x1, y1, x2, y2, steps = 12) => {
  await touch('touchStart', x1, y1);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.waitForTimeout(16); }
  await touch('touchEnd', x2, y2);
};
// Playwright's touch tap (Input.dispatchTouchEvent) on the element's centre,
// once nothing transient (a first-run tip fading out, …) sits on top of it.
const tapEl = async (locator, timeout = 30_000) => {
  await locator.waitFor({ timeout });
  const handle = await locator.elementHandle();
  await page.waitForFunction((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (el === top || el.contains(top));
  }, handle, { timeout }).catch(async () => {
    const who = await page.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const chain = []; for (let n = top; n && chain.length < 6; n = n.parentElement) chain.push(`${n.tagName}#${n.id}[${n.getAttribute('data-testid') ?? n.getAttribute('aria-label') ?? ''}]`);
      return chain.join(' < ');
    }, handle);
    console.log('  (element still covered by', who, '; tapping anyway)');
  });
  await locator.tap({ timeout: 5_000, force: true });
};
const labels = async () => (await page.$$eval('[aria-label]', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('aria-label')))).join(' | ').slice(0, 2500);
// Expo web's dev-only LogBox toast sits over the tab bar; hide it (dev overlay only, not app UI).
const dismissLogBox = async () => {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 1500 }).catch(() => {});
  await page.addStyleTag({ content: '#error-toast, [data-testid="logbox_toast"] { display: none !important; pointer-events: none !important; }' }).catch(() => {});
};

console.log('loading…');
// demo=1: the seeded preview posts (lib/devPreview.ts), so the feed has posts to swipe.
await openScreen(page, activity, ORIGIN, 'seller', '/', { extraQuery: '&demo=1' });
await page.waitForTimeout(6000);
await dismissLogBox();
await shot('01-seller-dashboard');

// ── Studio menu (touch-dispatched tap on the tab bar's Studio button) ──
const studioBtn = page.getByLabel('Open Studio tools').first();
console.log('studio button at', JSON.stringify(await studioBtn.boundingBox()));
await dismissLogBox();
await tapEl(studioBtn, 3_000);
// On the cold dev bundle the first tap only loads the lazily imported menu
// (app/_layout.tsx React.lazy) — a second tap opens it.
await page.waitForTimeout(3_000);
if (!(await page.getByTestId(/^seller-control-center-item-/).count())) { console.log('  first tap loaded the menu chunk; tapping again'); await tapEl(studioBtn, 3_000); }
await page.getByTestId(/^seller-control-center-item-/).first().waitFor({ timeout: 15_000 }).catch(() => console.log('menu did not mount'));
await page.waitForTimeout(1500);
await shot('02-studio-menu-first-card');
const first = await page.$$eval('[data-testid^="seller-control-center-item-"]', (els) => els.map((e) => [e.getAttribute('data-testid'), e.innerText.trim(), Math.round(e.getBoundingClientRect().x)]));
console.log('cards mounted:', JSON.stringify(first));
if (STEP === 'menu') { console.log(await labels()); process.exit(0); }

// Tap the current (first) card — opens straight away (tap skips the trace).
for (let attempt = 1; ; attempt++) {
  await tapEl(page.getByTestId('seller-control-center-item-watch-threads'), 3_000);
  try { await page.waitForURL(/\/watch-threads/, { timeout: 4_000 }); break; } catch {
    if (attempt === 3) throw new Error('Watch Threads card tap never navigated');
    console.log(`  card tap ${attempt} did not register; tapping again`);
  }
}
await page.waitForTimeout(5000);
await page.getByText('Tap to keep watching').click({ timeout: 2000 }).catch(() => {});
await shot('03-watch-threads-feed');
console.log(await labels());
if (STEP === 'feed') process.exit(0);

// ── Swipe up to the next post (vertical pager) ──
const firstCaption = await page.locator('[aria-label^="Shop "]').first().getAttribute('aria-label').catch(() => null);
await swipe(200, 620, 200, 180, 14);
await page.waitForTimeout(2500);
const nextCaption = await page.locator('[aria-label^="Shop "]').first().getAttribute('aria-label').catch(() => null);
console.log('  post before swipe:', firstCaption, '| after:', nextCaption);
await shot('04-swiped-next-post');

// ── Comments ──
await tapEl(page.locator('[aria-label^="Comments"]').first());
await page.waitForTimeout(2500);
await shot('05-comments-open');
const commentPosts = [];
page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'OPTIONS') commentPosts.push(`${r.method()} ${r.url().slice(0, 90)}`); });
const box = page.getByPlaceholder(/Add comment/i).first();
await box.click();
await box.fill('Love the cut on this one');
await page.waitForTimeout(400);
await tapEl(page.getByLabel('Send').first(), 5_000);
await page.waitForTimeout(2000);
console.log('  POSTs after Send:', JSON.stringify(commentPosts));
await shot('06-comment-posted');
await tapEl(page.getByLabel('Close comments').first(), 5_000);
await page.waitForTimeout(1500);
if (STEP === 'comments') { console.log(await labels()); process.exit(0); }

// ── Shop chip → product ──
await tapEl(page.locator('[aria-label^="Shop "]').first());
await page.waitForTimeout(3000);
await shot('07-shop-chip-sheet');
await tapEl(page.locator('[aria-label^="View details for"]').first(), 5_000);
await page.waitForURL(/product-detail/, { timeout: 30_000 });
await page.waitForTimeout(3000);
await shot('08-product-page');
if (STEP === 'shop') process.exit(0);

// ── Size → Add to bag ──
await tapEl(page.getByLabel('Size: select').first(), 5_000).catch(() => {});
await page.waitForTimeout(1200);
await tapEl(page.getByLabel('Size, M, $88.00').first(), 5_000);
await page.waitForTimeout(1200);
const cartWrites = [];
page.on('request', (r) => { if (/buyer\/cart/.test(r.url()) && r.method() !== 'OPTIONS') cartWrites.push(`${r.method()} ${new URL(r.url()).pathname}`); });
await shot('09-size-picked');
// The size sheet's own Add to bag (the page's sticky one sits behind it).
await tapEl(page.getByLabel('Add to bag', { exact: true }).last(), 5_000);
await page.waitForTimeout(3500);
console.log('  cart requests:', JSON.stringify(cartWrites));
await shot('10-added-to-bag');
if (STEP === 'size') process.exit(0);

// ── Bag (root stack /bag — no buyer tab shell) ──
await tapEl(page.getByLabel('View in bag').first(), 5_000);
await page.waitForURL(/\/bag|\/cart/, { timeout: 30_000 });
await page.waitForTimeout(3500);
const buyerShell = await page.getByLabel('Home tab').count();
console.log(`  bag route: ${new URL(page.url()).pathname}; buyer tab bar present: ${buyerShell > 0}`);
await shot('11-bag');
if (STEP === 'bag') process.exit(0);

// ── Checkout ──
const apiCalls = [];
page.on('request', (r) => { if (r.url().startsWith('https://api.brandthread.test') && r.method() !== 'OPTIONS') apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
await tapEl(page.getByText('Checkout', { exact: true }).last(), 5_000);
try { await page.waitForURL(/checkout/, { timeout: 15_000 }); } catch {
  await shot('debug-checkout-tap');
  console.log('  api after Checkout tap:', JSON.stringify(apiCalls));
  console.log(await labels());
  console.log((await page.locator('body').innerText()).slice(0, 800));
  process.exit(1);
}
await page.waitForTimeout(5000);
await shot('12-checkout');
console.log(await labels());

// ── Back out, one Back control at a time, to the seller dashboard ──
const backs = [/^Close (checkout|order review)$/, /^Close bag$/, /^Back to previous screen$/, /^Back$/];
for (const label of backs) {
  const el = page.getByLabel(label).filter({ visible: true }).first();
  if (!(await el.count())) { console.log('  no visible control', label); continue; }
  await tapEl(el, 5_000);
  await page.waitForTimeout(2500);
  console.log(`  ${label} → ${new URL(page.url()).pathname}`);
}
await page.waitForTimeout(1500);
await shot('13-back-on-seller-side');
console.log(await labels());
await browser.close();
