/**
 * Globe zoom-detail hands-on check (Expo web, Chromium, 390×844, demo
 * preview). In the dashboard card and in the expanded Live view, zooms in
 * over the US in steps with the scroll wheel (about the cursor), writing a
 * screenshot per step, and checks:
 *   - which layers show at each step (borders, country labels, state labels),
 *   - no two visible labels overlap and none is cut by the globe's box,
 *   - order dots still draw on top (pixel at a front order dot stays white),
 *   - a two-finger touch pinch zooms (browser touch input through CDP, and
 *     script-dispatched TouchEvents on the globe element), a vertical drag tilts the
 *     zoomed globe instead of scrolling the page,
 *   - frame pacing while dragging the zoomed globe, and at country level
 *     while it still auto-rotates.
 *
 *   node docs/qa/dashboard-globe-zoom/harness/globe-zoom-check.mjs /tmp/out/zoom
 */
import { chromium } from 'playwright';

const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://127.0.0.1:8081/?bt_preview=seller&demo=1';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
await page.route('**/npm/@clerk/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 240000 }).catch(() => {});
await page.getByTestId('seller-dashboard-scroll').first().waitFor({ timeout: 240000 });
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
await page.addStyleTag({ content: '[data-testid="logbox_toast"]{display:none!important}' });
await page.waitForFunction(() => !!globalThis.__btOrderGlobe && globalThis.__btOrderGlobe.activities.length > 0, null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);

const US = { lat: 39, lng: -96 };
const MIDWEST = { lat: 40.5, lng: -89 };

/** Visible labels (alpha > 0.15): count by kind, overlaps, edge cuts. */
async function labelAudit(testId = 'seller-order-globe') {
  return page.evaluate((id) => {
    const g = globalThis.__btOrderGlobe;
    // What the canvas actually drew this frame (after the label fade).
    const drawnOn = document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`);
    const items = drawnOn.__btLabels ?? [];
    const alphas = [...new Set(items.map((l) => +l.alpha.toFixed(3)))];
    const boxes = items.map((l) => ({ t: l.text, x0: l.x - l.width / 2, x1: l.x + l.width / 2, y0: l.y - l.font * 0.5, y1: l.y + l.font * 0.5 }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5) overlaps.push(`${a.t}/${b.t}`);
      }
    }
    const cut = boxes.filter((b) => b.x0 < 0 || b.y0 < 0 || b.x1 > g.size || b.y1 > g.size).map((b) => b.t);
    // Black text must sit on silver land: the canvas at the label box's
    // corners (beside the glyphs) should be land, not the near-black sea.
    const c = document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`);
    const ctx = c.getContext('2d');
    const k = c.width / g.size;
    const overSea = [];
    for (const b of boxes) {
      for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
        const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
        if (d[0] < 45) { overSea.push(b.t); break; }
      }
    }
    // Country labels are full names: no 2–3 letter codes except state ones.
    const states = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
      'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT','QLD','NSW','VIC','TAS','ACT','AC','AP','AM','PA','RO','RR','TO','BA','CE','DF','ES','GO','MA','MT','MS','MG','PB','PR','PE','PI','RJ','RN','RS','SC','SE','SP']);
    const codes = items.map((l) => l.text).filter((t) => /^[A-Z]{2,3}$/.test(t) && !states.has(t));
    const ellipsized = items.map((l) => l.text).filter((t) => /\.|…/.test(t));
    return { zoom: +g.view().zoom.toFixed(2), labels: items.map((l) => l.text), alphas, overlaps, cut, overSea, codes, ellipsized };
  }, testId);
}

async function zoomOver(testId, prefix) {
  const canvas = page.getByTestId(testId).getByTestId('seller-globe-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const card = page.getByTestId(testId);
  const steps = [];
  // Wait for the US to face the viewer (auto-rotation), then zoom on it.
  for (let i = 0; i < 160; i += 1) {
    const p = await page.evaluate(({ lat, lng }) => globalThis.__btOrderGlobe.projectLatLng(lat, lng), US);
    if (p[2] > 0.8) break;
    await page.waitForTimeout(500);
  }
  await card.screenshot({ path: `${OUT}-${prefix}-0-default.png` });
  steps.push({ step: 'default', ...(await labelAudit(testId)) });
  // Wheel deltas per step; zoom ×exp(-Δ·0.0015) about the cursor.
  const plan = [
    { name: '1-borders', target: 1.75, at: US },
    { name: '2-country-labels', target: 2.45, at: US },
    { name: '3-states', target: 4.2, at: MIDWEST },
    { name: '4-states-close', target: 8, at: MIDWEST },
    { name: '5-northeast', target: 16, at: { lat: 41.6, lng: -72.5 } },
    // Back out and over to Central America: small countries, full names only.
    { name: '6-zoom-out', target: 3, at: { lat: 20, lng: -90 } },
    { name: '7-central-america', target: 11, at: { lat: 14.6, lng: -88.6 } },
  ];
  /** Drags `at` to the middle of the box (a few strokes when it starts off screen). */
  async function centerOn(at) {
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let k = 0; k < 8; k += 1) {
      const p = await page.evaluate(({ lat, lng }) => globalThis.__btOrderGlobe.projectLatLng(lat, lng), at);
      const tx = box.x + p[0];
      const ty = box.y + p[1];
      if (Math.hypot(tx - cx, ty - cy) < 12) return;
      // Grab a point between the middle and the target (inside the box) and pull it in.
      const f = Math.min(1, (box.width * 0.42) / Math.max(1, Math.hypot(tx - cx, ty - cy)));
      const gx = cx + (tx - cx) * f;
      const gy = cy + (ty - cy) * f;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(cx - (gx - cx) * 0.02, cy - (gy - cy) * 0.02, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(120);
    }
  }
  for (const s of plan) {
    await centerOn(s.at);
    const box = await canvas.boundingBox();
    for (let k = 0; k < 40; k += 1) {
      const zoom = await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom);
      if (Math.abs(Math.log(zoom / s.target)) < 0.02) break;
      const p = await page.evaluate(({ lat, lng }) => globalThis.__btOrderGlobe.projectLatLng(lat, lng), s.at);
      // Steer toward the target place: cursor on it (clamped into the box).
      const x = box.x + Math.min(box.width - 10, Math.max(10, p[0]));
      const y = box.y + Math.min(box.height - 10, Math.max(10, p[1]));
      await page.mouse.move(x, y);
      const dy = Math.max(-120, Math.min(120, Math.log(zoom / s.target) / 0.0015));
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(40);
    }
    await centerOn(s.at);
    await page.waitForTimeout(3200); // fades settle; rotation is off when zoomed
    await card.screenshot({ path: `${OUT}-${prefix}-${s.name}.png` });
    steps.push({ step: s.name, ...(await labelAudit(testId)) });
    // Dots on top of the state lines and labels, at the state-level view.
    if (s.name === '3-states') steps[steps.length - 1].dots = await dotOnTop(testId);
  }
  return steps;
}

// Dots on top: at the zoomed view, the pixel at a front order dot's core is near-white.
async function dotOnTop(testId) {
  return page.evaluate((id) => {
    const g = globalThis.__btOrderGlobe;
    const c = document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`);
    const ctx = c.getContext('2d');
    const k = c.width / g.size;
    const hits = [];
    for (const a of g.activities) {
      if (a.kind !== 'order') continue;
      const p = g.project(a.id);
      if (!p || p[2] < 0.3 || p[0] < 8 || p[1] < 8 || p[0] > g.size - 8 || p[1] > g.size - 8) continue;
      const d = ctx.getImageData(Math.round(p[0] * k), Math.round(p[1] * k), 1, 1).data;
      hits.push({ city: a.order.city, rgb: [d[0], d[1], d[2]] });
    }
    return { checked: hits.length, white: hits.filter((h) => h.rgb.every((v) => v > 225)).length, sample: hits.slice(0, 4) };
  }, testId);
}

/**
 * A two-finger pinch built from script-created TouchEvents dispatched on the
 * globe element (no browser input pipeline, no pointer events), from world
 * view; returns the zoom before and after.
 */
async function dispatchedPinch(testId) {
  const canvas = page.getByTestId(testId).getByTestId('seller-globe-canvas');
  const b = await canvas.boundingBox();
  for (let k = 0; k < 40 && (await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom)) > 1.001; k += 1) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 200);
  }
  await page.waitForTimeout(300);
  const from = await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom);
  await page.evaluate(async ({ id, cx, cy }) => {
    const target = document.querySelector(`[data-testid="${id}"] [data-testid="seller-globe-canvas"]`);
    const touch = (d, n) => new Touch({ identifier: n, target, clientX: cx + (n ? d : -d), clientY: cy });
    const fire = (type, d) => {
      const all = [touch(d, 0), touch(d, 1)];
      const now = type === 'touchend' ? [] : all;
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: now, targetTouches: now, changedTouches: all }));
    };
    fire('touchstart', 20);
    for (let d = 24; d <= 90; d += 6) {
      fire('touchmove', d);
      await new Promise((r) => setTimeout(r, 16));
    }
    fire('touchend', 90);
  }, { id: testId, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
  await page.waitForTimeout(400);
  const to = await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom);
  return { from: +from.toFixed(2), to: +to.toFixed(2) };
}

const scroll = () => page.evaluate(() => document.querySelector('[data-testid="seller-dashboard-scroll"]')?.scrollTop ?? 0);

const cardSteps = await zoomOver('seller-order-globe', 'card');

// Zoomed: a vertical drag tilts the globe, the page doesn't scroll.
const canvasBox = await page.getByTestId('seller-order-globe').getByTestId('seller-globe-canvas').boundingBox();
const before = { view: await page.evaluate(() => globalThis.__btOrderGlobe.view()), scroll: await scroll() };
const mx = canvasBox.x + canvasBox.width / 2;
const my = canvasBox.y + canvasBox.height / 2;
// Frame pacing while dragging the state-level globe around.
const pacingP = page.evaluate(() => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const end = last + 2500;
  const tick = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(deltas); };
  requestAnimationFrame(tick);
}));
await page.mouse.move(mx, my - 60);
await page.mouse.down();
await page.mouse.move(mx + 10, my + 60, { steps: 40 });
await page.mouse.move(mx - 80, my + 20, { steps: 40 });
await page.mouse.up();
const deltas = (await pacingP).slice(1).sort((a, b) => a - b);
const after = { view: await page.evaluate(() => globalThis.__btOrderGlobe.view()), scroll: await scroll() };
const verticalDrag = { pitchChange: +(after.view.pitch - before.view.pitch).toFixed(3), pageScrolled: after.scroll !== before.scroll };
const fps = { frames: deltas.length, avgFps: +(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1), p95FrameMs: +deltas[Math.floor(deltas.length * 0.95)].toFixed(1) };

// Zoom back out to the default view: the detail is gone again.
await page.mouse.move(mx, my);
for (let k = 0; k < 40; k += 1) await page.mouse.wheel(0, 200);
await page.waitForTimeout(800);
await page.getByTestId('seller-order-globe').screenshot({ path: `${OUT}-card-6-back-out.png` });
const backOut = await labelAudit();

// Frame pacing at country level (zoom ~1.45: borders and country labels
// fading in while the globe still auto-rotates, the busiest detail frame).
await page.mouse.move(mx, my);
for (let k = 0; k < 20 && (await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom)) < 1.45; k += 1) {
  await page.mouse.wheel(0, -40);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(3500);
const rotating = await page.evaluate(() => new Promise((resolve) => {
  const g = globalThis.__btOrderGlobe; const yaw0 = g.view().yaw; const zoom = g.view().zoom;
  const deltas = []; let last = performance.now(); const end = last + 3000;
  const tick = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve({ deltas, zoom, turned: g.view().yaw - yaw0 }); };
  requestAnimationFrame(tick);
}));
const rd = rotating.deltas.slice(1).sort((a, b) => a - b);
const fpsCountryLevel = { zoom: +rotating.zoom.toFixed(2), rotatingRad: +rotating.turned.toFixed(3), avgFps: +(1000 / (rd.reduce((a, b) => a + b, 0) / rd.length)).toFixed(1), p95FrameMs: +rd[Math.floor(rd.length * 0.95)].toFixed(1) };
await page.getByTestId('seller-order-globe').screenshot({ path: `${OUT}-card-6b-country-level-rotating.png` });
for (let k = 0; k < 10; k += 1) await page.mouse.wheel(0, 200);
await page.waitForTimeout(500);

// Two-finger touch pinch (web touch events through CDP).
const cdp = await ctx.newCDPSession(page);
const z0 = await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom);
const pts = (d) => [{ x: mx - d, y: my, id: 0 }, { x: mx + d, y: my, id: 1 }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
for (let d = 24; d <= 90; d += 6) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await page.waitForTimeout(16);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(400);
const z1 = await page.evaluate(() => globalThis.__btOrderGlobe.view().zoom);
const pinch = { from: +z0.toFixed(2), to: +z1.toFixed(2) };
const cardDispatchedPinch = await dispatchedPinch('seller-order-globe');
await page.getByTestId('seller-order-globe').screenshot({ path: `${OUT}-card-7-after-pinch.png` });
for (let k = 0; k < 40; k += 1) { await page.mouse.move(mx, my); await page.mouse.wheel(0, 200); }

// Expanded (full-screen) view.
await page.getByTestId('seller-live-map-expand').first().click();
await page.getByTestId('seller-live-map-full-map').waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
const fullSteps = await zoomOver('seller-live-map-full-map', 'full');
await page.screenshot({ path: `${OUT}-full-screen-390x844.png` });
const fullDispatchedPinch = await dispatchedPinch('seller-live-map-full-map');
await page.getByTestId('seller-live-map-full-map').screenshot({ path: `${OUT}-full-8-dispatched-pinch.png` });

await ctx.close();
await browser.close();
console.log(JSON.stringify({ cardSteps, verticalDrag, fps, fpsCountryLevel, backOut, pinch, cardDispatchedPinch, fullSteps, fullDispatchedPinch, errors }, null, 1));
