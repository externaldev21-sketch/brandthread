/**
 * Shared helpers for the Design Studio (Procreate) walkthrough: open the
 * preview build signed in as the demo seller, create canvases, and DRAW on
 * them with real pointer input (mouse for single strokes, CDP touch events
 * for multi-finger gestures).
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import * as harness from '../store-screenshots/harness.mjs';
import * as demoImages from '../store-screenshots/demo-images.mjs';

export const WORK_DIR = harness.WORK_DIR;

export const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };

/** The harness's launcher, falling back to the container's pre-installed Chromium when the project's Playwright pins a different browser build. */
async function launch() {
  try {
    return await harness.launchBrowser();
  } catch (error) {
    const { chromium } = await import('playwright');
    const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
    return chromium.launch({ executablePath });
  }
}

export async function start({ build = !process.env.SKIP_BUILD } = {}) {
  if (build) harness.buildPreviewWeb();
  const browser = await launch();
  const images = await demoImages.ensureDemoImages(browser, path.join(harness.MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const served = await harness.serveBuild(harness.DEFAULT_BUILD_DIR);
  return { browser, images, origin: served.origin, close: async () => { served.close(); await browser.close(); } };
}

export async function openStudio(env, { acceptDownloads = true } = {}) {
  const { context, page, activity } = await harness.openContext(env.browser, {
    device: DEVICE, role: 'seller', origin: env.origin, images: env.images, onUnseeded: () => {},
    contextOptions: { acceptDownloads }, installClock: false,
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${env.origin}/design?bt_preview=seller`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await harness.waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  await page.waitForTimeout(600);
  return { context, page, errors };
}

export async function newCanvas(page, presetId = 'ig_post') {
  await page.locator('[data-testid="header-new-canvas"]').first().click();
  await page.waitForTimeout(500);
  await page.locator(`[data-testid="preset-${presetId}"]`).first().click();
  await page.waitForSelector('[data-testid="paint-surface"]', { timeout: 15_000 });
  // The New Canvas sheet fades out over the canvas route; wait until it's gone.
  await page.waitForSelector('[data-testid="new-canvas-sheet"]', { state: 'detached', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export async function artboardBox(page) {
  const box = await page.locator('[data-testid="canvas-artboard"]').boundingBox();
  if (!box) throw new Error('artboard not found');
  return box;
}

/** Draws a polyline given in artboard fractions (0..1) with one finger (CDP touch events), N interpolated steps per segment. */
export async function stroke(page, pts, { steps = 8, delay = 8, holdMs = 0, box } = {}) {
  const b = box ?? await artboardBox(page);
  const abs = pts.map(([fx, fy]) => ({ x: b.x + fx * b.width, y: b.y + fy * b.height }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...abs[0], id: 1 }] });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i < abs.length; i++) {
    const a = abs[i - 1], c = abs[i];
    for (let k = 1; k <= steps; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (c.x - a.x) * (k / steps), y: a.y + (c.y - a.y) * (k / steps), id: 1 }] });
      if (delay) await page.waitForTimeout(delay);
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(120);
}

/** Touch-and-hold at a point (fractions), optionally dragging, for the eyedropper. Returns before lifting if `keep` is set. */
export async function hold(page, [fx, fy], { ms = 800, keep = false } = {}) {
  const b = await artboardBox(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + fx * b.width, y: b.y + fy * b.height, id: 1 }] });
  await page.waitForTimeout(ms);
  const lift = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); await page.waitForTimeout(150); };
  if (keep) return lift;
  await lift();
  return null;
}

/** One-finger drag between two absolute points (CDP touch), e.g. a layer's reorder handle. */
export async function touchDrag(page, from, to, { steps = 12 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 3 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * (i / steps), y: from.y + (to.y - from.y) * (i / steps), id: 3 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(300);
}

export function circlePts(cx, cy, r, n = 40, from = 0, to = Math.PI * 2, ry = r) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + (to - from) * (i / n);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry];
  });
}

/** Multi-finger tap via CDP touch events (two-finger tap = undo, three = redo). */
export async function multiTap(page, fingers) {
  const b = await artboardBox(page);
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = Array.from({ length: fingers }, (_, i) => ({ x: b.x + b.width * (0.35 + i * 0.12), y: b.y + b.height * 0.5, id: i + 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  await cdp.detach();
}

/** Two-finger pinch/rotate via CDP touch events. */
export async function pinch(page, { scale = 1.6, rotateDeg = 0, steps = 12 } = {}) {
  const b = await artboardBox(page);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const r0 = 50;
  const at = (k) => {
    const r = r0 * (1 + (scale - 1) * k);
    const a = (rotateDeg * Math.PI / 180) * k;
    return [
      { x: cx - Math.cos(a) * r, y: cy - Math.sin(a) * r, id: 1 },
      { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, id: 2 },
    ];
  };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  await cdp.detach();
}

export function shotDir(name) {
  const dir = path.resolve(harness.MOBILE_ROOT, '../../docs/pr-assets', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
