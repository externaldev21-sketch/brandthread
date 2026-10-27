/**
 * Captures the demo globe as a frame sequence (Expo web, Chromium, 390×844)
 * for the PR's animation: ~6 s at ~12 fps of the globe card, plus a
 * real-time screen recording (.webm). Assemble with ffmpeg / PIL.
 *
 *   node docs/qa/dashboard-globe-v2/harness/globe-v2-animation.mjs /tmp/out/anim
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
const OUT = process.argv[2];
fs.mkdirSync(`${OUT}-frames`, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  recordVideo: { dir: `${OUT}-video`, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
await page.route('**/npm/@clerk/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.goto('http://127.0.0.1:8081/?bt_preview=seller&demo=1', { waitUntil: 'networkidle', timeout: 240000 }).catch(() => {});
await page.getByTestId('seller-dashboard-scroll').first().waitFor({ timeout: 240000 });
await page.addStyleTag({ content: '[data-testid="logbox_toast"]{display:none!important}' });
const globe = page.getByTestId('seller-dashboard-live-map').first();
await globe.scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('[data-testid="seller-dashboard-scroll"]')?.scrollBy(0, 160));
await page.waitForFunction(() => !!globalThis.__btOrderGlobe && globalThis.__btOrderGlobe.activities.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(2500);
const box = await page.getByTestId('seller-globe-canvas').boundingBox();
const t0 = Date.now(); let n = 0;
while (Date.now() - t0 < 6000) {
  await page.screenshot({ path: `${OUT}-frames/${String(n).padStart(3, '0')}.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  n += 1;
}
const secs = (Date.now() - t0) / 1000;
await page.waitForTimeout(1000);
await ctx.close();
await browser.close();
console.log(JSON.stringify({ frames: n, seconds: secs, fps: +(n / secs).toFixed(1) }));
