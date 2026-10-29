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
 *   node scripts/store-screenshots/watch-threads-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/watch-threads'));
const STEP = process.env.STEP ?? 'all';
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const { page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images, seedOptions: {} });
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
  }, handle, { timeout }).catch(() => console.log('  (element still covered; tapping anyway)'));
  await locator.tap({ timeout: 5_000, force: true });
};
const labels = async () => (await page.$$eval('[aria-label]', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('aria-label')))).join(' | ').slice(0, 2500);
// Expo web's dev-only LogBox toast sits over the tab bar; hide it (dev overlay only, not app UI).
const dismissLogBox = async () => {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 1500 }).catch(() => {});
  await page.addStyleTag({ content: '#error-toast, [data-testid="logbox_toast"] { display: none !important; pointer-events: none !important; }' }).catch(() => {});
};

console.log('loading…');
await openScreen(page, activity, ORIGIN, 'seller', '/');
await page.waitForTimeout(6000);
await dismissLogBox();
await shot('01-seller-dashboard');

// ── Studio menu (touch-dispatched tap on the tab bar's Studio button) ──
const studioBtn = page.getByLabel('Open Studio tools').first();
console.log('studio button at', JSON.stringify(await studioBtn.boundingBox()));
await dismissLogBox();
await tapEl(studioBtn);
await page.getByTestId(/^seller-control-center-item-/).first().waitFor({ timeout: 15_000 }).catch(() => console.log('menu did not mount'));
await page.waitForTimeout(1500);
await shot('02-studio-menu-first-card');
const first = await page.$$eval('[data-testid^="seller-control-center-item-"]', (els) => els.map((e) => [e.getAttribute('data-testid'), e.innerText.trim(), Math.round(e.getBoundingClientRect().x)]));
console.log('cards mounted:', JSON.stringify(first));
if (STEP === 'menu') { console.log(await labels()); process.exit(0); }

// Tap the current (first) card — opens straight away (tap skips the trace).
await tapEl(page.getByTestId('seller-control-center-item-watch-threads'));
await page.waitForTimeout(5000);
await page.getByText('Tap to keep watching').click({ timeout: 2000 }).catch(() => {});
await shot('03-watch-threads-feed');
console.log(await labels());
if (STEP === 'feed') process.exit(0);
await browser.close();
