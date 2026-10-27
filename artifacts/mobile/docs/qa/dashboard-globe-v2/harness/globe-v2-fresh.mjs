/**
 * Fresh-store globe (Expo web, Chromium, 390×844, `?bt_preview=seller`
 * without demo): no dots, no arcs, the empty caption, no visitor caption.
 *
 *   node docs/qa/dashboard-globe-v2/harness/globe-v2-fresh.mjs /tmp/out/v2
 */
import { chromium } from 'playwright';
const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
await page.route('**/npm/@clerk/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.goto('http://127.0.0.1:8081/?bt_preview=seller', { waitUntil: 'networkidle', timeout: 240000 }).catch(() => {});
await page.getByTestId('seller-dashboard-scroll').first().waitFor({ timeout: 240000 });
const globe = page.getByTestId('seller-dashboard-live-map').first();
await globe.scrollIntoViewIfNeeded();
await page.waitForFunction(() => !!globalThis.__btOrderGlobe, null, { timeout: 30000 });
await page.waitForTimeout(3000);
const state = await page.evaluate(() => ({ activities: globalThis.__btOrderGlobe.activities.length, liveArcs: globalThis.__btOrderGlobe.liveArcs() }));
await globe.screenshot({ path: `${OUT}-globe-fresh-store.png` });
const caption = await page.getByTestId('seller-globe-caption').first().innerText();
const sessionsCaption = await page.getByTestId('seller-globe-sessions-caption').count();
console.log(JSON.stringify({ ...state, caption, sessionsCaption, errors }));
await browser.close();
