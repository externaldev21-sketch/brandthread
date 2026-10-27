/**
 * Globe v2 hands-on check (Expo web, Chromium, 390×844, demo preview):
 * solid land, activity-only dots, arcs in flight, frame pacing, order and
 * session popovers, drag/zoom. Writes PNGs (and a .webm recording) next to
 * OUT and prints a JSON summary.
 *
 *   node docs/qa/dashboard-globe-v2/harness/globe-v2-check.mjs /tmp/out/v2
 */
import { chromium } from 'playwright';
const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://127.0.0.1:8081/?bt_preview=seller&demo=1';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  recordVideo: { dir: `${OUT}-video`, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
// Offline, Clerk's hosted JS can't load; keep the request from hanging (demo preview needs no auth).
await page.route('**/npm/@clerk/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 240000 }).catch(() => {});
await page.getByTestId('seller-dashboard-scroll').first().waitFor({ timeout: 240000 });
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
await page.addStyleTag({ content: '[data-testid="logbox_toast"]{display:none!important}' });
const globe = page.getByTestId('seller-dashboard-live-map').first();
await globe.scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('[data-testid="seller-dashboard-scroll"]')?.scrollBy(0, 160));
await page.waitForFunction(() => !!globalThis.__btOrderGlobe && globalThis.__btOrderGlobe.activities.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// Frame pacing over 4 s (rAF deltas) and how many arcs fly at once.
const pacing = await page.evaluate(() => new Promise((resolve) => {
  const deltas = []; const arcs = []; let last = performance.now(); const end = last + 4000;
  const tick = (t) => {
    deltas.push(t - last); last = t; arcs.push(globalThis.__btOrderGlobe.liveArcs());
    if (t < end) requestAnimationFrame(tick); else resolve({ deltas, arcs });
  };
  requestAnimationFrame(tick);
}));
const sorted = [...pacing.deltas].slice(1).sort((a, b) => a - b);
const fps = { frames: sorted.length, avgFps: +(1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length)).toFixed(1), p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), over33ms: sorted.filter((d) => d > 33.4).length };
const arcStats = { max: Math.max(...pacing.arcs), min: Math.min(...pacing.arcs), avg: +(pacing.arcs.reduce((a, b) => a + b, 0) / pacing.arcs.length).toFixed(2) };

for (const n of [1, 2, 3]) { await globe.screenshot({ path: `${OUT}-globe-frame-${n}.png` }); await page.waitForTimeout(450); }
const canvasBox = await page.getByTestId('seller-globe-canvas').boundingBox();

// Land is solid: sample a grid of pixels inside the disc, count bright ones.
const landShare = await page.evaluate(() => {
  const c = document.querySelector('[data-testid="seller-globe-canvas"]'); const ctx = c.getContext('2d');
  const w = c.width; const d = ctx.getImageData(0, 0, w, w).data; let disc = 0, lit = 0;
  const r = w * 0.42; const cx = w / 2;
  for (let y = 0; y < w; y += 3) for (let x = 0; x < w; x += 3) {
    if ((x - cx) ** 2 + (y - cx) ** 2 > (r * 0.9) ** 2) continue; disc += 1;
    const i = (y * w + x) * 4; if (d[i] > 80) lit += 1;
  }
  return +(lit / disc).toFixed(3);
});

async function frontMost(kind) {
  return page.evaluate((k) => {
    const g = globalThis.__btOrderGlobe; let best = null;
    for (const a of g.activities) { if (a.kind !== k) continue; const p = g.project(a.id); if (p && p[2] > (best?.p[2] ?? 0.35)) best = { a, p }; }
    return best;
  }, kind);
}
async function waitFront(kind) {
  for (let i = 0; i < 180; i += 1) { const t = await frontMost(kind); if (t) return t; await page.waitForTimeout(500); }
  return null;
}
const orderT = await waitFront('order');
await page.mouse.click(canvasBox.x + orderT.p[0], canvasBox.y + orderT.p[1]);
await page.getByTestId('seller-globe-popover').waitFor({ timeout: 5000 });
const orderPop = {
  expected: { number: orderT.a.order.orderNumber, city: orderT.a.order.city, amountCents: orderT.a.order.amountCents },
  number: await page.getByTestId('seller-globe-popover-number').innerText(),
  item: await page.getByTestId('seller-globe-popover-item').innerText(),
  amount: await page.getByTestId('seller-globe-popover-amount').innerText(),
  place: await page.getByTestId('seller-globe-popover-place').innerText(),
  time: await page.getByTestId('seller-globe-popover-time').innerText(),
};
await page.waitForTimeout(300);
await globe.screenshot({ path: `${OUT}-globe-order-popover.png` });
await page.getByLabel('Close order details').click();
await page.waitForTimeout(300);

const sessionT = await waitFront('session');
await page.mouse.click(canvasBox.x + sessionT.p[0], canvasBox.y + sessionT.p[1]);
await page.getByTestId('seller-globe-session-popover').waitFor({ timeout: 5000 });
const sessionPop = { expected: sessionT.a.session, label: await page.getByTestId('seller-globe-session-popover-label').innerText() };
await page.waitForTimeout(300);
await globe.screenshot({ path: `${OUT}-globe-session-popover.png` });
await page.getByLabel('Close visitor details').click();
await page.waitForTimeout(300);

// An order dot where shoppers are browsing too: the order popover adds "N sessions right now".
const bothT = await page.evaluate(async () => {
  const g = globalThis.__btOrderGlobe;
  for (let i = 0; i < 180; i += 1) {
    const hit = g.activities.find((a) => a.kind === 'order' && a.sessions > 0 && (g.project(a.id)?.[2] ?? 0) > 0.35);
    if (hit) return { a: hit, p: g.project(hit.id) };
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
});
let bothPop = null;
if (bothT) {
  await page.mouse.click(canvasBox.x + bothT.p[0], canvasBox.y + bothT.p[1]);
  await page.getByTestId('seller-globe-popover').waitFor({ timeout: 5000 });
  bothPop = {
    expected: { number: bothT.a.order.orderNumber, sessions: bothT.a.sessions },
    number: await page.getByTestId('seller-globe-popover-number').innerText(),
    place: await page.getByTestId('seller-globe-popover-place').innerText(),
    sessions: await page.getByTestId('seller-globe-popover-sessions').innerText(),
  };
  await page.waitForTimeout(300);
  await globe.screenshot({ path: `${OUT}-globe-order-with-sessions-popover.png` });
  await page.getByLabel('Close order details').click();
  await page.waitForTimeout(300);
}

const v1 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 90, cy + 5, { steps: 8 }); await page.mouse.up();
const v2 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(400);
const v3 = await page.evaluate(() => globalThis.__btOrderGlobe.view());
await globe.screenshot({ path: `${OUT}-globe-zoomed.png` });
await page.mouse.wheel(0, 600); await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}-dashboard-390x844.png` });
const captions = {
  orders: await page.getByTestId('seller-globe-caption').first().innerText(),
  sessions: await page.getByTestId('seller-globe-sessions-caption').first().innerText().catch(() => null),
};
await page.waitForTimeout(4000);
await ctx.close();
console.log(JSON.stringify({ fps, arcStats, landShare, orderPop, sessionPop, bothPop, dragYaw: +(v2.yaw - v1.yaw).toFixed(3), zoom: [v2.zoom, +v3.zoom.toFixed(3)], captions, errors }, null, 1));
await browser.close();
