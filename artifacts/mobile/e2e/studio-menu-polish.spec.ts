/**
 * Studio menu polish pass — live verification on the built web preview
 * (same harness as e2e/studio-header-text-fit.spec.ts: static preview
 * build + mocked API, no live backend):
 *
 *  1. First-time swipe coach: visible on open in `&demo=1`, dismissed by a
 *     tap (which must NOT open the card) and by the first swipe (which must
 *     still scrub to the next card).
 *  2. Edge chevrons: ‹ hidden on the first card, › at ~35%; both idle on a
 *     middle card; mid-drag the chevron in the drag direction brightens
 *     and stretches while the other fades. Neither takes a touch.
 *  3. Title exit motion: during the last ~400ms before the page disappears
 *     the title lifts ~12px and tremors; before that it is still. Proven
 *     with a rAF transform log on the real title element, plus a frame
 *     strip for the PR.
 *  4. Edge-trace corners: at the moment the trace is fully drawn, its
 *     corner radius is concentric with the device's display corners
 *     (393x852 / 430x932 → 55−8 = 47; 375x667 → square; iPad sizes on the
 *     web preview → square), on every size incl. iPad landscape — asserted
 *     on the live path and by sampling the rendered corner pixels, with
 *     zoomed corner crops saved for the PR.
 *  5. Text-fit & alignment guard (Dev's rule): no text element on the menu
 *     — header, title, coach copy — overflows its box or its parent.
 *
 * Local run (after `node -e "import('./scripts/store-screenshots/harness.mjs').then(h=>h.buildPreviewWeb())"`):
 *   pnpm exec playwright test e2e/studio-menu-polish.spec.ts --config e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function loadHarness() {
  return import('../scripts/store-screenshots/harness.mjs') as Promise<{
    DEFAULT_BUILD_DIR: string;
    launchBrowser: () => Promise<any>;
    openContext: (browser: any, opts: any) => Promise<{ context: any; page: any; activity: any }>;
    openScreen: (page: any, activity: any, origin: string, role: string, target: string, opts?: { extraQuery?: string }) => Promise<void>;
    serveBuild: (buildDir: string) => Promise<{ origin: string; close: () => void }>;
    waitForQuietNetwork: (activity: any, quietMs?: number, timeout?: number) => Promise<void>;
  }>;
}

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_USER_AGENT =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const OUT_DIR = process.env.STUDIO_POLISH_OUT_DIR ?? path.join(process.cwd(), 'e2e', '.studio-menu-polish-out');
mkdirSync(OUT_DIR, { recursive: true });

/** Same scan as e2e/studio-header-text-fit.spec.ts: any text element whose
 *  content overflows its own box, or whose box overflows its parent. */
const TEXT_FIT_SCAN = `(() => {
  const root = document.querySelector(__ROOT__);
  if (!root) return { skipped: true, offenders: [] };
  const offenders = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent && n.textContent.trim()).map((n) => n.textContent).join('');
    if (!ownText) continue;
    if (el.scrollWidth > el.clientWidth + 1) offenders.push({ kind: 'text-overflow', text: ownText.slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    if (parent && rect.width > 0 && rect.height > 0) {
      const pStyle = getComputedStyle(parent);
      if (style.position !== 'absolute' && style.position !== 'fixed' && pStyle.overflow !== 'hidden') {
        const prect = parent.getBoundingClientRect();
        if (rect.right > prect.right + 1 || rect.left < prect.left - 1) offenders.push({ kind: 'box-overflows-parent', text: ownText.slice(0, 60), rect: { left: rect.left, right: rect.right }, parentRect: { left: prect.left, right: prect.right } });
      }
    }
  }
  return { skipped: false, offenders };
})()`;

type Harness = Awaited<ReturnType<typeof loadHarness>>;

interface OpenOpts {
  viewport: { width: number; height: number };
  demo?: boolean;
  motion?: boolean;
  tablet?: boolean;
}

async function openStudio(h: Harness, browser: any, origin: string, opts: OpenOpts) {
  const device = { viewport: opts.viewport, scale: 2, isMobile: true, userAgent: opts.tablet ? IPAD_USER_AGENT : IPHONE_USER_AGENT };
  // Real clock: this spec measures timed animations frame by frame (see
  // harness.mjs's installClock note).
  const { context, page, activity } = await h.openContext(browser, { device, role: 'seller', origin, images: {}, installClock: false });
  if (opts.motion) await page.emulateMedia({ reducedMotion: 'no-preference' });
  await h.openScreen(page, activity, origin, 'seller', '/(tabs)/', { extraQuery: opts.demo ? '&demo=1' : '' });
  await h.waitForQuietNetwork(activity, 800, 15_000);
  await page.getByTestId('seller-bottom-menu').click();
  await page.waitForTimeout(700);
  await expect(page.getByTestId('seller-studio-header')).toBeVisible();
  return { context, page, activity };
}

/** A horizontal scrub on the card area: press at the screen centre, move
 *  `dx` px (negative = finger left = next card), optionally release. */
async function scrub(page: any, dx: number, { release = true, steps = 8 } = {}) {
  const vp = page.viewportSize();
  const x = vp.width / 2;
  const y = vp.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps });
  // A real finger never lifts in the same frame as its last move: the
  // carousel's 90ms step slide has to have started before the release
  // rounds to the nearest card (cardAreaPan's onEnd).
  if (release) { await page.waitForTimeout(160); await page.mouse.up(); }
}

/** Cancels an in-flight auto-enter trace WITHOUT opening or closing: a
 *  slow, short vertical drag (a new touch cancels the trace; a slow drag
 *  under the dismiss threshold just snaps back; a plain tap would OPEN the
 *  card, a fast flick would close the page). */
async function cancelTrace(page: any) {
  const vp = page.viewportSize();
  const x = vp.width / 2;
  const y = vp.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 36, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function opacityOf(page: any, testId: string): Promise<number> {
  return page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return el ? Number(getComputedStyle(el).opacity) : -1;
  }, testId);
}

async function currentTitle(page: any): Promise<string> {
  // The centred card's title — the one label whose layer sits at translateX 0.
  return page.evaluate(() => {
    const area = document.querySelector('[data-testid="seller-studio-card-area"]');
    if (!area) return '';
    const page = area.parentElement!;
    const labels = Array.from(page.querySelectorAll('div')).filter((d) => {
      const own = Array.from(d.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim());
      if (!own) return false;
      const t = d.textContent?.trim() ?? '';
      return t.length > 0 && t.length < 24 && getComputedStyle(d).fontSize === '20px';
    });
    let best: { text: string; dist: number } | null = null;
    for (const l of labels) {
      const r = l.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - window.innerWidth / 2);
      if (!best || dist < best.dist) best = { text: l.textContent!.trim(), dist };
    }
    return best?.text ?? '';
  });
}

test.setTimeout(0);

test.describe('Studio menu polish @ built preview', () => {
  let h: Harness;
  let origin: string;
  let close: () => void;
  let browser: any;

  test.beforeAll(async () => {
    h = await loadHarness();
    ({ origin, close } = await h.serveBuild(h.DEFAULT_BUILD_DIR));
    browser = await h.launchBrowser();
  });
  test.afterAll(async () => {
    await browser?.close();
    close?.();
  });

  test('first-time swipe coach: shows in &demo=1, tap dismisses without opening, first swipe dismisses and still scrubs', async () => {
    const { page } = await openStudio(h, browser, origin, { viewport: { width: 393, height: 852 }, demo: true, motion: true });
    try {
      const coach = page.getByTestId('seller-studio-swipe-coach');
      await expect(coach).toBeVisible();
      await page.waitForTimeout(450); // 200ms fade-in + a hand half-cycle
      await expect(coach).toHaveCSS('opacity', '1');
      await expect(coach).toHaveCSS('pointer-events', 'none');
      await expect(coach).toContainText('Swipe to switch');
      await page.screenshot({ path: path.join(OUT_DIR, '01-coach-overlay.png') });
      await page.screenshot({ path: path.join(OUT_DIR, '01b-coach-overlay-zoom.png'), clip: { x: 76, y: 326, width: 240, height: 200 } });

      // Text-fit on the coach itself.
      const scan = await page.evaluate(TEXT_FIT_SCAN.replace('__ROOT__', JSON.stringify('[data-testid="seller-studio-swipe-coach"]')));
      expect(scan.offenders, JSON.stringify(scan.offenders)).toEqual([]);

      // Tap: coach fades out, we are STILL on the Studio page (no card opened).
      const titleBefore = await currentTitle(page);
      await page.mouse.click(196, 426);
      await expect(coach).toBeHidden({ timeout: 1500 });
      await expect(page.getByTestId('seller-studio-header')).toBeVisible();
      expect(await currentTitle(page)).toBe(titleBefore);
      await page.screenshot({ path: path.join(OUT_DIR, '02-coach-dismissed-by-tap.png') });

      // Re-open (demo: every open) and dismiss with the first swipe — which
      // must still advance to the next card.
      await page.getByTestId('seller-studio-menu-close').click();
      await page.waitForTimeout(500);
      await page.getByTestId('seller-bottom-menu').click();
      await page.waitForTimeout(700);
      await expect(coach).toBeVisible();
      const first = await currentTitle(page);
      await scrub(page, -40);
      await expect(coach).toBeHidden({ timeout: 1500 });
      await page.waitForTimeout(250);
      const after = await currentTitle(page);
      expect(after).not.toBe(first);
      await page.screenshot({ path: path.join(OUT_DIR, '03-coach-dismissed-by-swipe-next-card.png') });
      await cancelTrace(page);
      await expect(page.getByTestId('seller-studio-header')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('edge chevrons: hidden at the list ends, ~35% idle, brighten + stretch toward the drag, never intercept touches', async () => {
    const { page } = await openStudio(h, browser, origin, { viewport: { width: 393, height: 852 }, motion: true });
    try {
      const rail = page.getByTestId('seller-studio-edge-chevrons');
      await expect(rail).toHaveCSS('pointer-events', 'none');
      // First card: ‹ hidden, › resting.
      expect(await opacityOf(page, 'seller-studio-edge-chevron-left')).toBeLessThan(0.02);
      expect(await opacityOf(page, 'seller-studio-edge-chevron-right')).toBeCloseTo(0.35, 1);
      // Geometry: inside the safe area, 8px from the edge, vertically centred, ~9px glyph.
      const right = await page.getByTestId('seller-studio-edge-chevron-right').boundingBox();
      expect(right).not.toBeNull();
      expect(right!.width).toBeLessThanOrEqual(10);
      expect(Math.round(393 - (right!.x + right!.width))).toBe(8);
      expect(Math.abs(right!.y + right!.height / 2 - 426)).toBeLessThan(1.5);
      await page.screenshot({ path: path.join(OUT_DIR, '04-chevrons-first-card.png') });

      // Middle card: both idle.
      await scrub(page, -40);
      await cancelTrace(page);
      expect(await opacityOf(page, 'seller-studio-edge-chevron-left')).toBeCloseTo(0.35, 1);
      expect(await opacityOf(page, 'seller-studio-edge-chevron-right')).toBeCloseTo(0.35, 1);
      await page.screenshot({ path: path.join(OUT_DIR, '05-chevrons-idle.png') });
      await page.screenshot({ path: path.join(OUT_DIR, '05b-chevron-left-zoom.png'), clip: { x: 0, y: 406, width: 40, height: 40 } });
      await page.screenshot({ path: path.join(OUT_DIR, '05c-chevron-right-zoom.png'), clip: { x: 353, y: 406, width: 40, height: 40 } });

      // Mid-drag, finger moving LEFT ~28px (the Pan reports ~18px past its
      // 10px activation, ≈0.55 of a card step): › brightens toward
      // 0.35 + 0.55*0.55 ≈ 0.65 and stretches; ‹ fades toward 0.
      await scrub(page, -28, { release: false, steps: 8 });
      await page.waitForTimeout(150);
      const rightMid = await opacityOf(page, 'seller-studio-edge-chevron-right');
      const leftMid = await opacityOf(page, 'seller-studio-edge-chevron-left');
      expect(rightMid).toBeGreaterThan(0.5);
      expect(rightMid).toBeLessThanOrEqual(0.9);
      expect(leftMid).toBeLessThan(0.25);
      const rightTransform = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="seller-studio-edge-chevron-right"]')!).transform);
      const scaleX = Number(/matrix\(([^,]+),/.exec(rightTransform)?.[1] ?? 1);
      expect(scaleX).toBeGreaterThan(1.1);
      await page.screenshot({ path: path.join(OUT_DIR, '06-chevrons-mid-drag.png') });
      await page.screenshot({ path: path.join(OUT_DIR, '06b-chevron-right-mid-drag-zoom.png'), clip: { x: 353, y: 406, width: 40, height: 40 } });
      await page.mouse.up();
      await cancelTrace(page);
    } finally {
      await page.close();
    }
  });

  test('title exit motion: still until the last ~400ms, then lifts ~12px with a slow→fast tremor, ending as the page goes', async () => {
    const { page } = await openStudio(h, browser, origin, { viewport: { width: 393, height: 852 }, motion: true });
    try {
      await scrub(page, -40);
      const title = await currentTitle(page);
      // rAF logger on the title element: {t(ms since release), x, y} from the computed matrix.
      const released = Date.now();
      await page.evaluate((text: string) => {
        const el = Array.from(document.querySelectorAll('div')).find((d) => d.textContent?.trim() === text && getComputedStyle(d).fontSize === '20px')!;
        const log: Array<{ t: number; x: number; y: number; trace: number }> = [];
        const t0 = performance.now();
        (window as any).__titleLog = log;
        const tick = () => {
          if (!el.isConnected) return;
          const m = getComputedStyle(el).transform;
          const parts = /matrix\(([^)]+)\)/.exec(m)?.[1].split(',').map(Number);
          const p = document.querySelector('[data-testid="seller-studio-entering-trace"] path');
          const trace = p ? Number(p.getAttribute('stroke-dashoffset') ?? getComputedStyle(p).strokeDashoffset.replace('px', '')) : -1;
          log.push({ t: Math.round(performance.now() - t0), x: parts ? parts[4] : 0, y: parts ? parts[5] : 0, trace });
          setTimeout(tick, 12);
        };
        tick();
      }, title);
      // Frame strip across the exit window (trace 1500ms + burst 220ms;
      // exit runs ~1320→1720ms after release). Clipped to the title band.
      const clip = { x: 0, y: 700, width: 393, height: 152 };
      const marks = [1200, 1360, 1450, 1540, 1630, 1700];
      for (const m of marks) {
        await page.waitForTimeout(Math.max(0, m - (Date.now() - released)));
        await page.screenshot({ path: path.join(OUT_DIR, `07-title-exit-${String(m).padStart(4, '0')}ms.png`), clip });
      }
      await page.waitForTimeout(600);
      const log: Array<{ t: number; x: number; y: number; trace: number }> = await page.evaluate(() => (window as any).__titleLog);
      writeFileSync(path.join(OUT_DIR, '07-title-exit-log.json'), JSON.stringify(log));
      expect(log.length).toBeGreaterThan(40);
      // The exit window starts when the title first moves and ends with the
      // last frame the title exists (the page is gone the frame after).
      const startIdx = log.findIndex((s) => Math.abs(s.y) > 0.3 || Math.abs(s.x) > 0.3);
      expect(startIdx).toBeGreaterThan(5);
      const before = log.slice(0, startIdx);
      const during = log.slice(startIdx);
      const end = log[log.length - 1];
      // Still (no slide, no tremor) the whole time before the window...
      expect(Math.max(...before.map((s) => Math.abs(s.y)))).toBeLessThan(0.3);
      expect(Math.max(...before.map((s) => Math.abs(s.x)))).toBeLessThan(0.3);
      // ...the window itself lasts ~350-450ms and starts while the trace is still closing
      // (i.e. it overlaps the end of the push-in, not just the burst)...
      const windowMs = end.t - log[startIdx].t;
      expect(windowMs).toBeGreaterThan(300);
      expect(windowMs).toBeLessThan(520);
      expect(log[startIdx].trace).toBeGreaterThan(0);
      // ...it lifts to ~12px by the end, with a tremor whose x crosses zero
      // repeatedly and never exceeds 2.5px.
      expect(end.y).toBeLessThan(-9);
      const xs = during.map((s) => s.x);
      let crossings = 0;
      for (let i = 1; i < xs.length; i++) if (Math.sign(xs[i]) !== Math.sign(xs[i - 1]) && xs[i] !== 0) crossings++;
      expect(crossings).toBeGreaterThanOrEqual(3);
      expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(2.6);
      // Slow → fast: more zero-crossings in the second half of the window than the first.
      const half = Math.floor(xs.length / 2);
      const count = (arr: number[]) => { let c = 0; for (let i = 1; i < arr.length; i++) if (Math.sign(arr[i]) !== Math.sign(arr[i - 1]) && arr[i] !== 0) c++; return c; };
      expect(count(xs.slice(half))).toBeGreaterThanOrEqual(count(xs.slice(0, half)));
      // The page is gone (navigated into the card's destination).
      await expect(page.getByTestId('seller-studio-header')).toBeHidden({ timeout: 3000 });
    } finally {
      await page.close();
    }
  });

  const TRACE_SIZES: Array<{ name: string; w: number; h: number; tablet?: boolean; expectRadius: number }> = [
    { name: '393x852-iphone-15', w: 393, h: 852, expectRadius: 47 },
    { name: '430x932-iphone-15-plus', w: 430, h: 932, expectRadius: 47 },
    { name: '375x667-iphone-se', w: 375, h: 667, expectRadius: 0 },
    { name: '820x1180-ipad-portrait', w: 820, h: 1180, tablet: true, expectRadius: 0 },
    { name: '1180x820-ipad-landscape', w: 1180, h: 820, tablet: true, expectRadius: 0 },
    { name: '1024x1366-ipad-pro-portrait', w: 1024, h: 1366, tablet: true, expectRadius: 0 },
    { name: '1366x1024-ipad-pro-landscape', w: 1366, h: 1024, tablet: true, expectRadius: 0 },
  ];

  for (const size of TRACE_SIZES) {
    test(`edge-trace fully drawn @ ${size.name}: corners concentric with the display (r = ${size.expectRadius}), nothing clipped`, async () => {
      const { page } = await openStudio(h, browser, origin, { viewport: { width: size.w, height: size.h }, motion: true, tablet: size.tablet });
      try {
        const released = Date.now();
        await scrub(page, -40);
        // The trace draws over 1500ms, top-centre clockwise, so the top-LEFT
        // arc is the last corner drawn (~91-94% of the perimeter): capture
        // at ~1460ms, when all four corners are on screen and the burst
        // (1500ms+) hasn't started.
        // The path geometry is static from the moment the trace mounts — read
        // it first, since a 2x screenshot of an iPad-sized page can take long
        // enough for the burst + navigation to unmount it afterwards.
        await page.waitForTimeout(Math.max(0, 1200 - (Date.now() - released)));
        const d: string = await page.evaluate(() => document.querySelector('[data-testid="seller-studio-entering-trace"] path')?.getAttribute('d') ?? '');
        await page.waitForTimeout(Math.max(0, 1470 - (Date.now() - released)));
        const file = path.join(OUT_DIR, `08-trace-${size.name}.png`);
        await page.screenshot({ path: file });
        // Zoomed corner crops.
        const c = 72;
        const corners = { 'top-left': { x: 0, y: 0 }, 'top-right': { x: size.w - c, y: 0 }, 'bottom-left': { x: 0, y: size.h - c }, 'bottom-right': { x: size.w - c, y: size.h - c } };
        for (const [name, pos] of Object.entries(corners)) {
          await page.screenshot({ path: path.join(OUT_DIR, `08-trace-${size.name}-corner-${name}.png`), clip: { ...pos, width: c, height: c } });
        }
        await cancelTrace(page);
        // Geometry: all four arcs carry the expected radius, inset 8.
        const arcs = Array.from(d.matchAll(/A ([\d.]+) ([\d.]+)/g)).map((m) => Number(m[1]));
        expect(arcs).toHaveLength(4);
        for (const r of arcs) expect(r).toBe(size.expectRadius);
        expect(d.startsWith(`M ${size.w / 2} 8`)).toBe(true);
        // Pixels: a point on the arc is drawn, the old square corner is not.
        const png = await readPng(file);
        if (png) {
          const inset = 8;
          const r = size.expectRadius;
          const cx = inset + r;
          const cy = inset + r;
          // Sampled on the three corners the clockwise trace has finished
          // well before the capture (top-right ~5%, bottom-right ~45%,
          // bottom-left ~55%); the top-left arc is the LAST thing drawn
          // (~91-94%) and lands within a frame or two of the capture, so it
          // is verified by the geometry above and its zoomed crop.
          const k = r > 0 ? r * Math.SQRT1_2 : 0;
          const onArc = r > 0
            ? [{ x: size.w - cx + k, y: cy - k }, { x: size.w - cx + k, y: size.h - cy + k }, { x: cx - k, y: size.h - cy + k }]
            : [{ x: size.w - inset, y: inset }, { x: size.w - inset, y: size.h - inset }, { x: inset, y: size.h - inset }];
          for (const p of onArc) expect(luma(png, p.x, p.y), `arc point ${JSON.stringify(p)}`).toBeGreaterThan(150);
          if (r > 0) {
            // The square corners the old fixed-28px-radius path used to run
            // through (and the glass clipped) carry no stroke now.
            expect(luma(png, size.w - inset - 2, inset + 2)).toBeLessThan(110);
            expect(luma(png, size.w - inset - 2, size.h - inset - 2)).toBeLessThan(110);
            expect(luma(png, inset + 2, size.h - inset - 2)).toBeLessThan(110);
          }
        }
      } finally {
        await page.close();
      }
    });
  }

  test('text-fit & alignment: no text on the Studio menu overflows its box or its parent (header, title, chevrons)', async () => {
    const { page } = await openStudio(h, browser, origin, { viewport: { width: 393, height: 852 } });
    try {
      const scan = await page.evaluate(TEXT_FIT_SCAN.replace('__ROOT__', JSON.stringify('[data-testid="seller-studio-header"]')));
      expect(scan.offenders, JSON.stringify(scan.offenders)).toEqual([]);
      const area = await page.evaluate(TEXT_FIT_SCAN.replace('__ROOT__', JSON.stringify('[data-testid="seller-studio-card-area"]')));
      expect(area.offenders, JSON.stringify(area.offenders)).toEqual([]);
      // The whole Studio page (the title layers are siblings of the card
      // area, inside the page View) — not the Dashboard underneath the modal.
      const whole = await page.evaluate(TEXT_FIT_SCAN.replace('document.querySelector(__ROOT__)', 'document.querySelector(\'[data-testid="seller-studio-card-area"]\')?.parentElement'));
      expect(whole.offenders, JSON.stringify(whole.offenders)).toEqual([]);
      await page.screenshot({ path: path.join(OUT_DIR, '09-menu-header-zoom.png'), clip: { x: 0, y: 0, width: 393, height: 120 } });
      await page.screenshot({ path: path.join(OUT_DIR, '09b-menu-title-zoom.png'), clip: { x: 0, y: 740, width: 393, height: 112 } });
    } finally {
      await page.close();
    }
  });
});

// ─── PNG sampling (pngjs is available transitively in this workspace) ─────────
type Png = { width: number; height: number; data: Uint8Array };
async function readPng(file: string): Promise<Png | null> {
  try {
    // Transitive dependency with no bundled types; the specifier is widened
    // so tsc doesn't try to resolve a declaration file for it.
    const { PNG } = (await import('pngjs' as string)) as { PNG: { sync: { read: (buf: Buffer) => unknown } } };
    const { readFileSync } = await import('node:fs');
    return PNG.sync.read(readFileSync(file)) as unknown as Png;
  } catch {
    return null;
  }
}
/** Max luma in a 3x3 CSS-px window (screenshots are 2x) around (x, y). */
function luma(png: Png, x: number, y: number): number {
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = Math.round((x + dx) * 2);
    const py = Math.round((y + dy) * 2);
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
    const i = (py * png.width + px) * 4;
    const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    if (l > best) best = l;
  }
  return best;
}
