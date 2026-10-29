/**
 * Globe zoom on the production preview export (what /fast-preview serves),
 * driven like the store-screenshot harness (seller preview, fake clock,
 * reduced motion): in the dashboard card and the full-screen Live view,
 * a two-finger pinch built from script-dispatched TouchEvents on the globe,
 * then mouse-wheel zoom in, then a non-bubbling wheel dispatched on the
 * canvas itself. Prints how much silver land each canvas shows after each
 * step (it grows as the globe zooms) and writes screenshots.
 *
 * Export first with buildPreviewWeb() from scripts/store-screenshots/harness.mjs, then
 *   node docs/qa/dashboard-globe-zoom/harness/fast-preview-zoom-probe.mjs <build dir> <out dir> [noclock]
 */
import { openContext, openScreen, serveBuild, waitForQuietNetwork } from '../../../../scripts/store-screenshots/harness.mjs';
const BUILD = process.argv[2]; const OUT = process.argv[3]; const CLOCK = process.argv[4] !== 'noclock';
const { origin, close } = await serveBuild(BUILD);
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {}, installClock: CLOCK });
const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await openScreen(page, activity, origin, 'seller', '/(tabs)', { extraQuery: '&demo=1' });
await waitForQuietNetwork(activity, 600, 10000).catch(() => {});
await page.waitForTimeout(1500);
for (const name of [/continue setup later/i, /accept all/i, /^got it$/i, /^ok$/i]) {
  await page.getByRole('button', { name }).first().click({ timeout: 1500 }).catch(() => {});
  await page.getByText(name).first().click({ timeout: 800 }).catch(() => {});
  await page.waitForTimeout(400);
}
const sig = (id) => page.evaluate((id) => { const c = document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 80) lit++; return lit; }, id);
async function test(id, tag) {
  const canvas = page.locator(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`);
  await canvas.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  const b = await canvas.boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const s0 = await sig(id);
  await page.screenshot({ path: `${OUT}/${tag}-0.png` });
  // Dispatched touch pinch, like the report.
  const pinched = await page.evaluate(async ({ id, cx, cy }) => {
    const el = document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`);
    const tgt = el.parentElement;
    const mk = (d, idn) => new Touch({ identifier: idn, target: tgt, clientX: cx + (idn ? d : -d), clientY: cy });
    const fire = (type, d) => { const ts = type === 'touchend' ? [] : [mk(d, 0), mk(d, 1)]; tgt.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ts, targetTouches: ts, changedTouches: [mk(d, 0), mk(d, 1)] })); };
    fire('touchstart', 20); for (let d = 24; d < 100; d += 6) { fire('touchmove', d); await new Promise((r) => setTimeout(r, 16)); } fire('touchend', 100);
    return true;
  }, { id, cx, cy });
  await page.waitForTimeout(800);
  const s1 = await sig(id);
  await page.screenshot({ path: `${OUT}/${tag}-2-pinch.png` });
  await page.mouse.move(cx, cy);
  for (let k = 0; k < 10; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(50); }
  await page.waitForTimeout(800);
  const s1w = await sig(id);
  await page.screenshot({ path: `${OUT}/${tag}-1-wheel.png` });
  // A wheel dispatched straight on the canvas, not bubbling.
  for (let k = 0; k < 6; k++) await page.evaluate(({ id, cx, cy }) => {
    document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`).dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: cx, clientY: cy, cancelable: true }));
  }, { id, cx, cy });
  await page.waitForTimeout(600);
  const s3 = await sig(id);
  console.log(tag, JSON.stringify({ s0, afterPinch: s1, afterWheel: s1w, afterCanvasWheelOut: s3, pinched }));
}
await test('seller-order-globe', 'card');
await page.getByTestId('seller-live-map-expand').first().click();
await page.getByTestId('seller-live-map-full').waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
await test('seller-live-map-full-map', 'full');
console.log('errors', JSON.stringify(errs));
await context.close(); await browser.close(); close();
