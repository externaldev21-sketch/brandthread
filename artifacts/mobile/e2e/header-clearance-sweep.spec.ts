/**
 * "Header + bottom-clearance sweep" — live verification on the built web
 * preview (static preview build + mocked API, fresh seller; same harness as
 * e2e/studio-header-text-fit.spec.ts) at 393x852.
 *
 *  1. Bottom clearance: every seller tab-bar screen (the four tabs + the
 *     tab-group pages) and a spread of pushed screens is scrolled to the
 *     bottom (every scroll container), and NO visible content element may
 *     overlap the floating tab bar — the last element's bottom sits above
 *     the bar's top edge.
 *  2. Nothing under the notch: after scrolling, the whole status-bar strip
 *     [0, safe-area top) is the solid mask on every one of those screens
 *     (document.elementFromPoint across the strip), and no visible element
 *     is on top of it.
 *  3. Headers: bare back arrow + title — no subtitle text, no divider —
 *     on screens that used to carry one ("Last 7 days", "30 days", ...).
 *  4. Analytics tab: range pills (Today), EQUAL Visits/Revenue tiles, empty
 *     chart ~120px titled "Revenue".
 *  5. Seller profile: bigger avatar, chips stacked ("Seller" over the plan
 *     chip), EQUAL Edit/Messages; the three tab empty states share one
 *     layout ~32px under the tabs, slim white fit-to-text pills, and the
 *     badge glyph is optically centred — pixel-checked to within 0.5px.
 *  6. The same badge on three other empty states.
 *  7. Dev's text-fit guard on every screen touched.
 *
 * Local run (after `node -e "import('./scripts/store-screenshots/harness.mjs').then(h=>h.buildPreviewWeb())"`):
 *   pnpm exec playwright test e2e/header-clearance-sweep.spec.ts --config e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
type Harness = Awaited<ReturnType<typeof loadHarness>>;

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 393, height: 852 };
const OUT_DIR = process.env.SWEEP_OUT_DIR ?? path.join(process.cwd(), 'e2e', '.header-clearance-sweep-out');
mkdirSync(OUT_DIR, { recursive: true });

/** Seller tab-bar screens: the tabs, the tab-group pages, and pushed screens the bar floats over. */
const TAB_BAR_SCREENS: Array<{ name: string; target: string }> = [
  { name: 'dashboard', target: '/(tabs)/' },
  { name: 'products', target: '/(tabs)/products' },
  { name: 'orders', target: '/(tabs)/orders' },
  { name: 'profile', target: '/(tabs)/profile' },
  { name: 'analytics', target: '/(tabs)/analytics' },
  { name: 'more', target: '/(tabs)/more' },
  { name: 'marketing', target: '/(tabs)/marketing' },
  { name: 'studio', target: '/(tabs)/studio' },
  { name: 'analytics-content', target: '/analytics-content' },
  { name: 'analytics-sales', target: '/analytics-sales' },
  { name: 'analytics-store', target: '/analytics-store' },
  { name: 'customers', target: '/customers' },
  { name: 'payouts', target: '/payouts' },
  { name: 'seller-inbox', target: '/seller-inbox' },
  { name: 'seller-settings', target: '/seller-settings' },
  { name: 'discounts', target: '/discounts' },
];

/** The URL path expo-router shows for a target (route groups are dropped). */
function expectedPath(target: string): string {
  const p = target.replace(/\/\([^)]+\)/g, '').replace(/\/$/, '');
  return p === '' ? '/' : p;
}

/**
 * Opens the seller shell, waits for it to SETTLE (the auth gate redirects to
 * the seller home once Clerk resolves — pushing the target before that lands
 * gets bounced back to "/"), then navigates client-side and verifies the
 * route actually landed and stayed, retrying if the gate bounced it.
 */
async function openSeller(h: Harness, browser: any, origin: string, target: string, opts: { zeroAnalytics?: boolean } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: IPHONE_USER_AGENT };
  const { page, activity } = await h.openContext(browser, { device, role: 'seller', origin, images: {}, seedOptions: { fresh: true }, apiOptions: { fresh: true } });
  if (opts.zeroAnalytics) {
    // A brand-new store: zero revenue in every bucket (the demo API's
    // /analytics/home isn't fresh-gated). Page routes win over the harness's
    // context route.
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    await page.route(/\/analytics\/home(\?|$)/, (route: any) => route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({
        range: 'today', totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0, conversionRate: 0, averageOrderCents: 0,
        threadCashReceivedCents: 0, toFulfill: 0, toCapture: 0,
        previous: { totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0 },
        trafficSources: [],
        buckets: Array.from({ length: 6 }, (_, i) => ({ bucket: new Date(Date.UTC(2026, 9, 6, i * 4)).toISOString(), totalCents: 0, orderCount: 0, visitorCount: 0 })),
      }),
    }));
  }
  await page.goto(`${origin}/?bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.waitForSelector('[data-testid="seller-dashboard-hero-value"]', { timeout: 20_000 });
  await h.waitForQuietNetwork(activity, 800, 15_000);
  const want = expectedPath(target);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (want !== '/') {
      await page.evaluate((url: string) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=seller`);
    }
    await page.waitForTimeout(1200);
    const path = await page.evaluate(() => location.pathname);
    if (path === want) break;
  }
  expect(await page.evaluate(() => location.pathname), `navigated to ${target}`).toBe(want);
  await h.waitForQuietNetwork(activity, 1000, 15_000);
  await page.waitForSelector('[data-testid="seller-global-tab-bar"]', { timeout: 20_000 });
  await page.waitForTimeout(700);
  return page;
}

/** Scrolls every scroll container on the page to its very bottom. */
async function scrollAllToBottom(page: any) {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
  await page.waitForTimeout(700);
}

/** Visible content elements (text, images, svg, filled/bordered boxes) that
 *  overlap the floating tab bar's band — after scrolling to the bottom
 *  there must be none. Excludes the bar itself, the status mask, and
 *  anything faded out or off-screen. */
const UNDER_BAR_SCAN = `(() => {
  const bar = document.querySelector('[data-testid="seller-global-tab-bar"]');
  if (!bar) return { barTop: null, offenders: [], lowest: null };
  // The bar's drawn capsules are its children; its own box may be wider.
  let barTop = Infinity;
  for (const el of bar.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 20 && r.height > 20 && r.top < barTop && r.top > window.innerHeight / 2) barTop = r.top;
  }
  if (!isFinite(barTop)) barTop = bar.getBoundingClientRect().top;
  const effectiveOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return 0;
      o *= parseFloat(s.opacity || '1');
    }
    return o;
  };
  const isContent = (el) => {
    if (el.tagName === 'IMG' || el.tagName === 'svg' || el.tagName === 'VIDEO' || el.tagName === 'INPUT') return true;
    if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent && n.textContent.trim())) return true;
    if (el.children.length) return false;
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    const hasBg = bg && bg !== 'transparent' && !/rgba\\(\\s*\\d+,\\s*\\d+,\\s*\\d+,\\s*0\\s*\\)/.test(bg);
    const hasBorder = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0;
    return hasBg || hasBorder;
  };
  const offenders = [];
  let lowest = -Infinity;
  for (const el of document.body.querySelectorAll('*')) {
    if (bar.contains(el)) continue;
    if (el.closest('[data-testid="status-bar-mask"]')) continue;
    if (el.closest('[data-testid="scene-bottom-clearance"]') === null && false) continue;
    if (!isContent(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) continue;
    // Full-screen backgrounds (scene planes, page roots) aren't content.
    if (r.height > window.innerHeight * 0.6 && r.width >= window.innerWidth - 1) continue;
    if (effectiveOpacity(el) < 0.05) continue;
    if (r.bottom > lowest) lowest = r.bottom;
    if (r.bottom > barTop + 0.5) {
      offenders.push({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 40), top: Math.round(r.top), bottom: Math.round(r.bottom), testID: el.closest('[data-testid]')?.getAttribute('data-testid') ?? null });
    }
  }
  return { barTop, offenders, lowest };
})()`;

/** The status strip: every probed point in [0, mask height) must land on
 *  the mask itself. */
const TOP_STRIP_SCAN = `(() => {
  const mask = document.querySelector('[data-testid="status-bar-mask"]');
  if (!mask) return { maskHeight: 0, misses: ['no mask'] };
  const h = mask.getBoundingClientRect().height;
  const misses = [];
  for (let y = 1; y < h; y += 6) {
    for (let x = 2; x < window.innerWidth; x += 24) {
      const hit = document.elementFromPoint(x, y);
      if (hit !== mask && !mask.contains(hit)) misses.push({ x, y, tag: hit?.tagName, text: (hit?.textContent || '').trim().slice(0, 30), testID: hit?.closest('[data-testid]')?.getAttribute('data-testid') ?? null });
    }
  }
  return { maskHeight: h, misses };
})()`;

const TEXT_FIT_SCAN = `((rootSel) => {
  const root = document.querySelector(rootSel);
  if (!root) return { skipped: true, offenders: [] };
  const offenders = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent && n.textContent.trim()).map((n) => n.textContent).join('');
    if (!ownText || !/[A-Za-z0-9]/.test(ownText)) continue;
    if (el.scrollWidth > el.clientWidth + 1) offenders.push({ kind: 'text-overflow', text: ownText.slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    if (parent && rect.width > 0 && rect.height > 0) {
      const pStyle = getComputedStyle(parent);
      if (style.position !== 'absolute' && style.position !== 'fixed' && pStyle.overflow !== 'hidden') {
        const prect = parent.getBoundingClientRect();
        if (rect.right > prect.right + 1 || rect.left < prect.left - 1) offenders.push({ kind: 'box-overflows-parent', text: ownText.slice(0, 60) });
      }
    }
  }
  return { skipped: false, offenders };
})`;
async function textFit(page: any, rootSel: string) {
  return page.evaluate(`${TEXT_FIT_SCAN}(${JSON.stringify(rootSel)})`) as Promise<{ skipped: boolean; offenders: any[] }>;
}

/** Bounding box of a pill-style button and its label (+ label overflow). */
async function pillFit(page: any, selector: string) {
  return page.evaluate((sel: string) => {
    const btn = document.querySelector(sel) as HTMLElement | null;
    if (!btn) return null;
    const label = Array.from(btn.querySelectorAll('*')).find((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && /[A-Za-z]/.test(n.textContent ?? ''))) as HTMLElement | undefined;
    const b = btn.getBoundingClientRect();
    const l = label?.getBoundingClientRect();
    let bg = '';
    for (let el: Element | null = btn; el; el = el.firstElementChild) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; }
    }
    return {
      btn: { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right },
      label: l ? { x: l.left, right: l.right, scrollWidth: label!.scrollWidth, clientWidth: label!.clientWidth, h: l.height } : null,
      text: label?.textContent?.trim() ?? '',
      bg,
    };
  }, selector);
}

// ── PNG pixel sampling for the badge centring check ──────────────────────────
type Png = { width: number; height: number; data: Uint8Array };
async function readPng(file: string): Promise<Png> {
  const { PNG } = (await import('pngjs' as string)) as { PNG: { sync: { read: (buf: Buffer) => unknown } } };
  return PNG.sync.read(readFileSync(file)) as Png;
}
/** Glyph centre vs CIRCLE centre, in CSS px, from a 2x screenshot of the
 *  badge (clipped with a little margin). The circle centre is measured from
 *  the ring's own pixels (the silver annulus), not assumed from the clip —
 *  so sub-pixel placement of the badge itself can't bias the result. The
 *  glyph is the bright (white stroke) pixels well inside the ring. */
function glyphOffset(png: Png, scale = 2) {
  const lumaAt = (x: number, y: number) => {
    const i = (y * png.width + x) * 4;
    return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
  };
  // Ring: the outer annulus — mid-grey pixels far from the clip centre.
  const ccx = png.width / 2, ccy = png.height / 2;
  let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const d = Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy);
      if (d < 26 * scale) continue;
      const l = lumaAt(x, y);
      if (l < 35 || l > 140) continue;
      if (x < rMinX) rMinX = x; if (x > rMaxX) rMaxX = x;
      if (y < rMinY) rMinY = y; if (y > rMaxY) rMaxY = y;
    }
  }
  const cx = (rMinX + rMaxX + 1) / 2;
  const cy = (rMinY + rMaxY + 1) / 2;
  const innerR = (rMaxX - rMinX + 1) / 2 - 4 * scale; // stay clear of the 2px ring + AA
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > innerR ** 2) continue;
      if (lumaAt(x, y) < 128) continue;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const gx = (minX + maxX + 1) / 2;
  const gy = (minY + maxY + 1) / 2;
  return { dx: (gx - cx) / scale, dy: (gy - cy) / scale, count, glyphW: (maxX - minX + 1) / scale, glyphH: (maxY - minY + 1) / scale, ringW: (rMaxX - rMinX + 1) / scale };
}

test.setTimeout(0);

test.describe('Header + bottom-clearance sweep @ 393x852', () => {
  let h: Harness;
  let origin: string;
  let close: () => void;
  let browser: any;
  const report: Record<string, unknown> = {};

  test.beforeAll(async () => {
    h = await loadHarness();
    ({ origin, close } = await h.serveBuild(h.DEFAULT_BUILD_DIR));
    browser = await h.launchBrowser();
  });
  test.afterAll(async () => {
    writeFileSync(path.join(OUT_DIR, 'sweep-report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    close?.();
  });

  for (const screen of TAB_BAR_SCREENS) {
    test(`${screen.name}: scrolled to the bottom nothing sits under the tab bar; scrolled, nothing sits under the notch`, async () => {
      const page = await openSeller(h, browser, origin, screen.target);
      try {
        // Scroll a little first: the status strip must still be solid.
        await page.evaluate(() => {
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
            const s = getComputedStyle(el);
            if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) el.scrollTop = 160;
          }
        });
        await page.waitForTimeout(400);
        const top = await page.evaluate(TOP_STRIP_SCAN);
        await page.screenshot({ path: path.join(OUT_DIR, `top-${screen.name}.png`), clip: { x: 0, y: 0, width: 393, height: 140 } });
        expect(top.maskHeight, `${screen.name}: status mask height`).toBeGreaterThanOrEqual(54);
        expect(top.misses, `${screen.name}: elements under the notch: ${JSON.stringify(top.misses.slice(0, 5))}`).toEqual([]);

        await scrollAllToBottom(page);
        const bottom = await page.evaluate(UNDER_BAR_SCAN);
        await page.screenshot({ path: path.join(OUT_DIR, `bottom-${screen.name}.png`) });
        report[screen.name] = { barTop: bottom.barTop, lowestContentBottom: bottom.lowest, gap: bottom.barTop - bottom.lowest };
        expect(bottom.barTop, `${screen.name}: tab bar`).not.toBeNull();
        expect(bottom.offenders, `${screen.name}: content under the tab bar: ${JSON.stringify(bottom.offenders.slice(0, 5))}`).toEqual([]);
        expect(bottom.lowest).toBeLessThan(bottom.barTop);
      } finally {
        await page.close();
      }
    });
  }

  test('headers: bare back arrow + title (no subtitle, no divider) where a subtitle used to be', async () => {
    for (const [name, target, title] of [
      ['analytics', '/(tabs)/analytics', 'Analytics'],
      ['analytics-content', '/analytics-content', 'Content Analytics'],
      ['analytics-sales', '/analytics-sales', 'Sales Analytics'],
      ['analytics-store', '/analytics-store', 'Store Analytics'],
      ['customers', '/customers', 'Customers'],
    ] as const) {
      const page = await openSeller(h, browser, origin, target);
      try {
        const header = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="screen-header"]') as HTMLElement | null;
          if (!el) return null;
          const texts = Array.from(el.querySelectorAll('*'))
            .filter((n) => Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent?.trim()))
            .map((n) => n.textContent!.trim())
            .filter((t) => /[A-Za-z0-9]/.test(t));
          const r = el.getBoundingClientRect();
          return { texts, border: parseFloat(getComputedStyle(el).borderBottomWidth), bottom: r.bottom };
        });
        expect(header, name).not.toBeNull();
        // Only the title (a right-hand header pill button, where a screen has one, is allowed).
        expect(header!.texts[0], name).toBe(title);
        expect(header!.texts.filter((t: string) => /days|All time|customer list/i.test(t)), name).toEqual([]);
        expect(header!.border, name).toBe(0);
        await page.screenshot({ path: path.join(OUT_DIR, `header-${name}.png`), clip: { x: 0, y: 0, width: 393, height: Math.ceil(header!.bottom) + 8 } });
        const fit = await textFit(page, '[data-testid="screen-header"]');
        expect(fit.offenders, `${name}: ${JSON.stringify(fit.offenders)}`).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  test('Analytics tab: Today pills, equal Visits/Revenue tiles, ~120px empty "Revenue" chart', async () => {
    // With revenue (the demo data): the full chart, for the PR screenshot.
    {
      const page = await openSeller(h, browser, origin, '/(tabs)/analytics');
      await page.screenshot({ path: path.join(OUT_DIR, 'analytics-with-revenue.png') });
      await page.close();
    }
    const page = await openSeller(h, browser, origin, '/(tabs)/analytics', { zeroAnalytics: true });
    try {
      await expect(page.getByTestId('seller-dashboard-range-pills')).toBeVisible();
      const tiles = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="analytics-stats-row"]')!;
        return Array.from(row.children).map((c) => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; });
      });
      expect(tiles).toHaveLength(2);
      expect(Math.abs(tiles[0].w - tiles[1].w)).toBeLessThanOrEqual(1);
      const chart = await page.evaluate(() => {
        // The card's section title (the last "Revenue" leaf — the first is the stat tile's label).
        const title = Array.from(document.querySelectorAll('div')).filter((d) => d.children.length === 0 && /^revenue$/i.test(d.textContent?.trim() ?? '')).pop();
        // The bar chart is the one wide svg on the screen.
        const svg = Array.from(document.querySelectorAll('svg')).find((el) => el.getBoundingClientRect().width > 250);
        return { title: title?.textContent?.trim(), svgH: svg ? svg.getBoundingClientRect().height : 0 };
      });
      expect(chart.title?.toLowerCase()).toBe('revenue');
      expect(Math.round(chart.svgH)).toBe(120);
      await page.screenshot({ path: path.join(OUT_DIR, 'analytics.png') });
      const fit = await textFit(page, 'body');
      expect(fit.offenders.filter((o: any) => !/^\$/.test(o.text ?? '')), JSON.stringify(fit.offenders)).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('seller profile: bigger avatar, stacked chips, equal Edit/Messages; three empty tabs share one layout ~32px under the tabs with an optically-centred badge', async () => {
    const page = await openSeller(h, browser, origin, '/(tabs)/profile');
    try {
      // ── Header ──
      const header = await page.evaluate(() => {
        const box = (sel: string) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom }; };
        const chips = document.querySelector('[data-testid="profile-identity-chips"]');
        return {
          // Letters only — each chip's Feather icon is an icon-font glyph.
          chips: chips ? Array.from(chips.children).map((c) => { const r = c.getBoundingClientRect(); return { text: (c.textContent ?? '').replace(/[^A-Za-z ]/g, '').trim(), x: r.left, y: r.top, h: r.height }; }) : [],
          edit: box('[data-testid="profile-edit-details"]'),
          messages: box('[data-testid="profile-messages-btn"]'),
        };
      });
      expect(header.chips.map((c: { text?: string }) => c.text)).toEqual(['Seller', expect.stringMatching(/Plan$/)]);
      expect(header.chips[1].y).toBeGreaterThan(header.chips[0].y + header.chips[0].h - 1); // stacked, not inline
      expect(Math.abs(header.chips[0].x - header.chips[1].x)).toBeLessThanOrEqual(1); // left-aligned
      expect(Math.abs(header.chips[0].h - header.chips[1].h)).toBeLessThanOrEqual(0.5); // same height
      expect(Math.abs(header.edit!.w - header.messages!.w)).toBeLessThanOrEqual(1); // equal columns
      expect(Math.abs(header.edit!.h - header.messages!.h)).toBeLessThanOrEqual(0.5);
      await page.screenshot({ path: path.join(OUT_DIR, 'profile-header.png'), clip: { x: 0, y: 0, width: 393, height: Math.min(852, Math.ceil(header.messages!.bottom) + 16) } });
      const headerFit = await textFit(page, '[data-testid="profile-identity-meta"]');
      expect(headerFit.offenders, JSON.stringify(headerFit.offenders)).toEqual([]);

      // ── The three tabs ──
      const tabs: Array<{ key: string; testID: string; title: string; pill: string | null }> = [
        { key: 'posts', testID: 'seller-own-empty-posts', title: 'No posts yet', pill: 'Create post' },
        { key: 'shop', testID: 'seller-own-empty-shop', title: 'No products yet', pill: 'Add a product' },
        { key: 'tagged', testID: 'seller-own-empty-tagged', title: 'No tagged posts', pill: null },
      ];
      const gaps: number[] = [];
      const offsets: Record<string, unknown> = {};
      for (const tab of tabs) {
        await page.getByTestId(`profile-tab-${tab.key}`).click();
        await page.waitForTimeout(700);
        const empty = page.getByTestId(tab.testID);
        await expect(empty).toBeVisible();
        await empty.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await expect(empty).toContainText(tab.title);
        // No filler sentence: the only copy is the title (+ the pill label).
        const words = await empty.evaluate((el: HTMLElement) => Array.from(el.querySelectorAll('*'))
          .filter((n) => Array.from(n.childNodes).some((c) => c.nodeType === 3 && /[A-Za-z]/.test(c.textContent ?? '')))
          .map((n) => n.textContent!.trim()));
        expect(words).toEqual(tab.pill ? [tab.title, tab.pill] : [tab.title]);
        // ~32px under the tab row.
        const tabsBottom = await page.evaluate(() => document.querySelector('[data-testid="profile-tab-posts"]')!.parentElement!.parentElement!.getBoundingClientRect().bottom);
        const badgeBox = await page.getByTestId(`${tab.testID}-badge`).boundingBox();
        gaps.push(badgeBox!.y - tabsBottom);
        expect(badgeBox!.y - tabsBottom, `${tab.key}: badge top vs tab row`).toBeGreaterThanOrEqual(26);
        expect(badgeBox!.y - tabsBottom, `${tab.key}: badge top vs tab row`).toBeLessThanOrEqual(40);
        expect(Math.round(badgeBox!.width)).toBe(64);
        // Optical centring: glyph bbox centre within 0.5px of the circle centre.
        const file = path.join(OUT_DIR, `badge-${tab.key}.png`);
        await page.screenshot({ path: file, clip: { x: badgeBox!.x - 4, y: badgeBox!.y - 4, width: badgeBox!.width + 8, height: badgeBox!.height + 8 } });
        const off = glyphOffset(await readPng(file));
        offsets[tab.key] = off;
        expect(off.count, `${tab.key}: glyph pixels`).toBeGreaterThan(40);
        expect(Math.abs(off.dx), `${tab.key}: glyph x offset ${off.dx}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(off.dy), `${tab.key}: glyph y offset ${off.dy}`).toBeLessThanOrEqual(0.5);
        // Slim white fit-to-text pill.
        if (tab.pill) {
          const fit = await pillFit(page, `[data-testid="${tab.testID}-action"]`);
          expect(fit!.text).toBe(tab.pill);
          expect(Math.round(fit!.btn.h)).toBe(36);
          expect(fit!.label!.scrollWidth).toBeLessThanOrEqual(fit!.label!.clientWidth);
          const left = fit!.label!.x - fit!.btn.x;
          const right = fit!.btn.right - fit!.label!.right;
          expect(Math.abs(left - right)).toBeLessThanOrEqual(1.5);
          expect(left).toBeGreaterThanOrEqual(12);
          expect(fit!.btn.w).toBeLessThan(200);
          expect(fit!.bg.replace(/\s/g, '')).toMatch(/^rgb\(2(4\d|5[0-5]),2(4\d|5[0-5]),2(4\d|5[0-5])\)$/);
        }
        const emptyBox = await empty.boundingBox();
        await page.screenshot({ path: path.join(OUT_DIR, `profile-empty-${tab.key}.png`) });
        await page.screenshot({ path: path.join(OUT_DIR, `profile-empty-${tab.key}-zoom.png`), clip: { x: 0, y: Math.max(0, tabsBottom - 8), width: 393, height: Math.min(852 - Math.max(0, tabsBottom - 8), (badgeBox!.y - tabsBottom) + 200) } });
        const fit = await textFit(page, `[data-testid="${tab.testID}"]`);
        expect(fit.offenders, JSON.stringify(fit.offenders)).toEqual([]);
        void emptyBox;
      }
      // Identical position on all three tabs.
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      report.profileEmptyGaps = gaps;
      report.badgeOffsets = offsets;

      // "Add a product" opens add-product (as a modal) and closing returns to the profile.
      await page.getByTestId('profile-tab-shop').click();
      await page.waitForTimeout(500);
      await page.getByTestId('seller-own-empty-shop-action').click();
      await page.waitForTimeout(1200);
      expect(page.url()).toContain('/add-product');
      expect(page.url()).toContain('presentation=modal');
    } finally {
      await page.close();
    }
  });

  test('the same badge on three other empty states', async () => {
    for (const [name, target, testIDHint] of [
      ['analytics-content', '/analytics-content', 'content-analytics-empty-badge'],
      ['seller-inbox', '/seller-inbox', null],
      ['customers', '/customers', null],
    ] as const) {
      const page = await openSeller(h, browser, origin, target);
      try {
        const badge = testIDHint
          ? page.getByTestId(testIDHint)
          : page.locator('[data-testid$="-badge"], [data-testid="empty-state-badge"]').first();
        await expect(badge, name).toBeVisible();
        const box = await badge.boundingBox();
        expect(Math.round(box!.width), name).toBe(64);
        const file = path.join(OUT_DIR, `badge-${name}.png`);
        await page.screenshot({ path: file, clip: { x: box!.x - 4, y: box!.y - 4, width: box!.width + 8, height: box!.height + 8 } });
        const off = glyphOffset(await readPng(file));
        report[`badge-${name}`] = off;
        expect(Math.abs(off.dx), `${name}: ${off.dx}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(off.dy), `${name}: ${off.dy}`).toBeLessThanOrEqual(0.5);
        await page.screenshot({ path: path.join(OUT_DIR, `empty-${name}.png`) });
        await page.screenshot({ path: path.join(OUT_DIR, `empty-${name}-zoom.png`), clip: { x: 0, y: Math.max(0, box!.y - 24), width: 393, height: 260 } });
      } finally {
        await page.close();
      }
    }
  });
});
