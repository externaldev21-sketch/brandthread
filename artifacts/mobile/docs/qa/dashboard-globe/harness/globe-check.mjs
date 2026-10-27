import { chromium } from 'playwright';
const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.goto('http://127.0.0.1:8081/?bt_preview=seller&demo=1', { waitUntil: 'networkidle', timeout: 240000 }).catch(() => {});
await page.getByTestId('seller-dashboard-scroll').first().waitFor({ timeout: 240000 });
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
await page.addStyleTag({ content: '[data-testid="logbox_toast"]{display:none!important}' });
const globe = page.getByTestId('seller-dashboard-live-map').first();
await globe.scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('[data-testid="seller-dashboard-scroll"]')?.scrollBy(0, 160));
await page.waitForFunction(() => !!globalThis.__btOrderGlobe && globalThis.__btOrderGlobe.orders.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(800);
await globe.screenshot({ path: `${OUT}-globe-a.png` });
const v1 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
await page.waitForTimeout(2500);
await globe.screenshot({ path: `${OUT}-globe-b.png` });
const v2 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
const canvasBox = await page.getByTestId('seller-globe-canvas').boundingBox();
// Pick the most front-facing order and tap it.
const target = await page.evaluate(() => {
  const g = globalThis.__btOrderGlobe;
  let best = null;
  for (const o of g.orders) { const p = g.project(o.id); if (p && p[2] > (best?.p[2] ?? 0.3)) best = { o, p }; }
  return best;
});
// Pixel at the dot must be bright (a glowing silver dot is drawn there).
const pixel = await page.evaluate(([x, y]) => {
  const c = document.querySelector('[data-testid="seller-globe-canvas"]');
  const ctx = c.getContext('2d'); const s = c.width / c.clientWidth;
  const d = ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data; return [...d];
}, [target.p[0], target.p[1]]);
await page.mouse.click(canvasBox.x + target.p[0], canvasBox.y + target.p[1]);
await page.getByTestId('seller-globe-popover').waitFor({ timeout: 5000 });
const pop = {
  number: await page.getByTestId('seller-globe-popover-number').innerText(),
  item: await page.getByTestId('seller-globe-popover-item').innerText(),
  amount: await page.getByTestId('seller-globe-popover-amount').innerText(),
  place: await page.getByTestId('seller-globe-popover-place').innerText(),
  time: await page.getByTestId('seller-globe-popover-time').innerText(),
  more: await page.getByTestId('seller-globe-popover-more').innerText().catch(() => null),
};
const fontFamily = await page.getByTestId('seller-globe-popover-number').evaluate((n) => getComputedStyle(n).fontFamily);
await page.waitForTimeout(1200);
const v3 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
await globe.screenshot({ path: `${OUT}-globe-popover.png` });
await page.screenshot({ path: `${OUT}-dashboard-viewport.png` });
// Close the popover (tapping the card itself opens the order), then drag to spin.
await page.getByLabel('Close order details').click();
await page.waitForTimeout(200);
const closed = !(await page.getByTestId('seller-globe-popover').count());
const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 90, cy + 5, { steps: 8 }); await page.mouse.up();
const v4 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
// Wheel zoom.
await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
const v5 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
await globe.screenshot({ path: `${OUT}-globe-zoomed.png` });
console.log(JSON.stringify({ closed, rotating: v2.yaw - v1.yaw, pausedWhileOpen: Math.abs(v3.yaw - v2.yaw) < 0.5, target: { ...target.o }, pixel, pop, fontFamily, dragYaw: v4.yaw - v3.yaw, zoom: [v4.zoom, v5.zoom], errors }, null, 1));
await browser.close();
