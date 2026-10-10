/**
 * Seller Dashboard + Content Analytics fixes — live verification on the
 * built web preview (static preview build + mocked API, fresh/zero-state
 * seller account; same harness as e2e/studio-header-text-fit.spec.ts):
 *
 *  Dashboard (393x852, scrolled to top AND bottom)
 *   - "Add a product" (setup card) fits its label: scrollWidth <= clientWidth,
 *     single line, equal left/right inner padding, slim ~36px, sized to text.
 *   - Setup card is the smaller spec (17px title, 13px body, 36px icon tile).
 *   - Empty chart is the shorter 112px band — no tall gap under "$0.00".
 *   - Traffic empty copy is exactly "No visits yet".
 *   - Content ends above the floating tab bar (last element bottom + 16 <=
 *     bar top) — nothing under or behind it.
 *   - Opens on Today.
 *   - Dev's text-fit guard: no text in the touched regions overflows its box.
 *
 *  Content Analytics (393x852)
 *   - Header: bare back arrow + title, no subtitle, no divider.
 *   - The Dashboard's own range pill row under the header, Today selected.
 *   - Empty state: "No views yet" / "Post a Thread to see how it performs." /
 *     slim white "Create post" pill (fits its text, equal padding) that
 *     opens the create screen; smaller icon circle; no "Seller".
 *
 * Local run (after `node -e "import('./scripts/store-screenshots/harness.mjs').then(h=>h.buildPreviewWeb())"`):
 *   pnpm exec playwright test e2e/seller-dashboard-fixes.spec.ts --config e2e/playwright.config.ts
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
type Harness = Awaited<ReturnType<typeof loadHarness>>;

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 393, height: 852 };
const OUT_DIR = process.env.DASHBOARD_FIXES_OUT_DIR ?? path.join(process.cwd(), 'e2e', '.seller-dashboard-fixes-out');
mkdirSync(OUT_DIR, { recursive: true });

/** Dev's text-fit guard: every text element under `root` whose content
 *  overflows its own box (scrollWidth > clientWidth) or whose box overflows
 *  its parent. `root` is a CSS selector, or `body`. */
const TEXT_FIT_SCAN = `((rootSel) => {
  const root = document.querySelector(rootSel);
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
})`;

async function textFit(page: any, rootSel: string) {
  return page.evaluate(`${TEXT_FIT_SCAN}(${JSON.stringify(rootSel)})`) as Promise<{ skipped: boolean; offenders: any[] }>;
}

/** Bounding box of a button, its single text label and (if any) its icon,
 *  plus the label's scroll/client widths — for the "fits its text, equal
 *  padding, one line" assertions. */
async function buttonFit(page: any, selector: string) {
  return page.evaluate((sel: string) => {
    const btn = document.querySelector(sel) as HTMLElement | null;
    if (!btn) return null;
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    // Text-bearing leaves: the label is the one with real letters; a Feather
    // icon renders as an icon-font glyph (a private-use character) in its
    // own text node.
    const texts = Array.from(btn.querySelectorAll('*')).filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim()));
    const label = texts.find((el) => /[A-Za-z]/.test(el.textContent ?? '')) as HTMLElement | undefined;
    const icon = (texts.find((el) => el !== label && !/[A-Za-z]/.test(el.textContent ?? '')) as HTMLElement | undefined) ?? null;
    return {
      btn: box(btn),
      label: label ? { ...box(label), scrollWidth: label.scrollWidth, clientWidth: label.clientWidth, lines: Math.round(label.getBoundingClientRect().height / (parseFloat(getComputedStyle(label).lineHeight) || parseFloat(getComputedStyle(label).fontSize) * 1.25)) } : null,
      icon: icon ? box(icon) : null,
      text: label?.textContent?.trim() ?? '',
    };
  }, selector);
}

/** The selected range pill is the one drawn in the theme's text colour
 *  (the rest are muted silver) — RN-web doesn't surface accessibilityState
 *  on a TouchableOpacity as an aria attribute. */
async function selectedRangePill(page: any): Promise<string> {
  return page.evaluate(() => {
    const pills = document.querySelector('[data-testid="seller-dashboard-range-pills"]');
    if (!pills) return '';
    let best: { t: string; luma: number } | null = null;
    for (const b of Array.from(pills.querySelectorAll('[role="button"]'))) {
      const label = b.firstElementChild as HTMLElement | null;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(label ? getComputedStyle(label).color : '');
      const luma = m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : 0;
      if (!best || luma > best.luma) best = { t: b.textContent?.trim() ?? '', luma };
    }
    return best?.t ?? '';
  });
}

async function openSeller(h: Harness, browser: any, origin: string, target: string) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: IPHONE_USER_AGENT };
  const { page, activity } = await h.openContext(browser, { device, role: 'seller', origin, images: {}, seedOptions: { fresh: true }, apiOptions: { fresh: true } });
  await h.openScreen(page, activity, origin, 'seller', target);
  await h.waitForQuietNetwork(activity, 1000, 15_000);
  // The client-side navigation occasionally lands a beat late on a cold
  // bundle — wait for the screen's own chrome before measuring anything.
  await page.waitForSelector('[data-testid="screen-header"], [data-testid="seller-dashboard-hero-value"]', { timeout: 20_000 });
  await page.waitForTimeout(700);
  return page;
}

test.setTimeout(0);

test.describe('Seller Dashboard + Content Analytics fixes @ 393x852', () => {
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

  test('Dashboard: setup-card button fits, card is the smaller spec, empty chart tightened, Today default, content ends above the tab bar', async () => {
    const page = await openSeller(h, browser, origin, '/(tabs)/');
    try {
      // ── Top ──
      await expect(page.getByTestId('seller-dashboard-hero-value')).toBeVisible();
      await page.screenshot({ path: path.join(OUT_DIR, '01-dashboard-top.png') });

      // Opens on Today.
      expect(await selectedRangePill(page)).toBe('Today');

      // Empty chart band is the shorter one: no tall gap under "$0.00".
      const chart = await page.getByTestId('seller-dashboard-chart').boundingBox();
      expect(chart).not.toBeNull();
      expect(Math.round(chart!.height)).toBe(112);
      const hero = await page.getByTestId('seller-dashboard-hero-value').boundingBox();
      // Hero value bottom → chart message centre: well under the old ~110px.
      expect(chart!.y + chart!.height / 2 - (hero!.y + hero!.height)).toBeLessThan(90);
      await page.screenshot({ path: path.join(OUT_DIR, '02-dashboard-hero-chart-zoom.png'), clip: { x: 0, y: Math.max(0, hero!.y - 40), width: 393, height: 240 } });

      // ── Setup card + its button (scroll it into view) ──
      const card = page.getByTestId('seller-dashboard-setup-card');
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const fit = await buttonFit(page, '[data-testid="seller-dashboard-setup-add-product"]');
      expect(fit).not.toBeNull();
      expect(fit!.text).toBe('Add a product');
      // Fits: never clips, single line.
      expect(fit!.label!.scrollWidth).toBeLessThanOrEqual(fit!.label!.clientWidth);
      expect(fit!.label!.right).toBeLessThanOrEqual(fit!.btn.right - 8);
      expect(fit!.label!.lines).toBe(1);
      // Slim 36px, sized to its content (not the card's full width).
      expect(Math.round(fit!.btn.h)).toBe(36);
      const cardBox = await card.boundingBox();
      expect(fit!.btn.w).toBeLessThan(cardBox!.width * 0.6);
      // Equal inner padding: left edge → first content (icon) == label right → right edge (±1.5).
      const leftPad = (fit!.icon ?? fit!.label!).x - fit!.btn.x;
      const rightPad = fit!.btn.right - fit!.label!.right;
      expect(Math.abs(leftPad - rightPad)).toBeLessThanOrEqual(1.5);
      expect(leftPad).toBeGreaterThanOrEqual(12);
      // Card type scale: 17px title, 13px body, 36px icon tile.
      const cardMetrics = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="seller-dashboard-setup-card"]')!;
        const texts = Array.from(card.querySelectorAll('*')).filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim()));
        const title = texts.find((t) => t.textContent?.trim() === 'List your first product') as HTMLElement;
        const body = texts.find((t) => t.textContent?.trim().startsWith('Your sales')) as HTMLElement;
        // The icon tile is the square box wrapping the plus-circle glyph.
        const glyph = texts.find((t) => !/[A-Za-z]/.test(t.textContent ?? '')) as HTMLElement;
        const tile = glyph.parentElement as HTMLElement;
        return { title: parseFloat(getComputedStyle(title).fontSize), body: parseFloat(getComputedStyle(body).fontSize), tile: tile.getBoundingClientRect().width };
      });
      expect(cardMetrics.title).toBe(17);
      expect(cardMetrics.body).toBe(13);
      expect(Math.round(cardMetrics.tile)).toBe(36);
      await page.screenshot({ path: path.join(OUT_DIR, '03-setup-card-zoom.png'), clip: { x: cardBox!.x - 8, y: cardBox!.y - 8, width: cardBox!.width + 16, height: cardBox!.height + 16 } });
      await page.screenshot({ path: path.join(OUT_DIR, '03b-add-product-button-zoom.png'), clip: { x: fit!.btn.x - 12, y: fit!.btn.y - 12, width: fit!.btn.w + 24, height: fit!.btn.h + 24 } });
      const cardScan = await textFit(page, '[data-testid="seller-dashboard-setup-card"]');
      expect(cardScan.offenders, JSON.stringify(cardScan.offenders)).toEqual([]);

      // ── Bottom ──
      await page.evaluate(() => { const s = document.querySelector('[data-testid="seller-dashboard-scroll"]') as HTMLElement; s.scrollTop = s.scrollHeight; });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT_DIR, '04-dashboard-bottom.png') });
      const bottom = await page.evaluate(() => {
        const box = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const bar = document.querySelector('[data-testid="seller-global-tab-bar"]');
        const traffic = document.querySelector('[data-testid="seller-dashboard-traffic-sources"]');
        const end = document.querySelector('[data-testid="seller-dashboard-scroll-end"]');
        const noVisits = Array.from(document.querySelectorAll('div')).find((d) => d.children.length === 0 && d.textContent?.trim().startsWith('No visits'));
        // The last visible content LEAF inside the scroll (deepest bottom
        // edge of any text/icon/box with no children — containers' own
        // padding boxes are not content) — must sit above the bar.
        const scroll = document.querySelector('[data-testid="seller-dashboard-scroll"]')!;
        let lowest = -Infinity;
        for (const el of scroll.querySelectorAll('*')) {
          if (el === end || end?.contains(el) || el.children.length > 0) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.width > 0 && r.bottom > lowest) lowest = r.bottom;
        }
        return { bar: box(bar), traffic: box(traffic), end: box(end), noVisitsText: noVisits?.textContent?.trim(), lowestContentBottom: lowest };
      });
      expect(bottom.bar).not.toBeNull();
      expect(bottom.noVisitsText).toBe('No visits yet');
      expect(bottom.traffic!.bottom).toBeLessThan(bottom.bar!.top);
      expect(bottom.lowestContentBottom + 16).toBeLessThanOrEqual(bottom.bar!.top + 0.5);
      const trafficBox = await page.getByTestId('seller-dashboard-traffic-sources').boundingBox();
      await page.screenshot({ path: path.join(OUT_DIR, '05-traffic-sources-zoom.png'), clip: { x: 0, y: Math.max(0, trafficBox!.y - 8), width: 393, height: Math.min(852 - trafficBox!.y + 8, trafficBox!.height + 16) } });
      const trafficScan = await textFit(page, '[data-testid="seller-dashboard-traffic-sources"]');
      expect(trafficScan.offenders, JSON.stringify(trafficScan.offenders)).toEqual([]);

      // Whole dashboard text-fit report (anything here is pre-existing and
      // outside this PR's regions — written out for the recap, not asserted).
      const all = await textFit(page, '[data-testid="seller-dashboard-scroll"]');
      writeFileSync(path.join(OUT_DIR, 'dashboard-text-fit-report.json'), JSON.stringify(all.offenders, null, 2));
    } finally {
      await page.close();
    }
  });

  test('Content Analytics: bare header (no subtitle, no divider), Dashboard range pills on Today, the new empty state with a slim "Create post" pill', async () => {
    const page = await openSeller(h, browser, origin, '/analytics-content');
    try {
      await expect(page.getByTestId('screen-header')).toBeVisible();
      await expect(page.getByTestId('content-analytics-empty')).toBeVisible();
      await page.screenshot({ path: path.join(OUT_DIR, '06-content-analytics.png') });

      // Header: title only, no subtitle text, no divider line.
      const header = await page.evaluate(() => {
        const h = document.querySelector('[data-testid="screen-header"]') as HTMLElement;
        // Real words only — the back arrow is an icon-font glyph (a private-use
        // character), not header copy.
        const texts = Array.from(h.querySelectorAll('*')).filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim())).map((el) => el.textContent!.trim()).filter((t) => /[A-Za-z0-9]/.test(t));
        return { texts, borderBottom: getComputedStyle(h).borderBottomWidth };
      });
      expect(header.texts).toEqual(['Content Analytics']);
      expect(parseFloat(header.borderBottom)).toBe(0);

      // The Dashboard's range pills, directly under the header, Today selected.
      const pills = page.getByTestId('seller-dashboard-range-pills');
      await expect(pills).toBeVisible();
      const labels = await pills.evaluate((el: HTMLElement) => Array.from(el.querySelectorAll('[role="button"]')).map((b) => b.textContent?.trim()));
      expect(labels).toEqual(['Today', 'Week', 'Month', 'Year', 'All']);
      expect(await selectedRangePill(page)).toBe('Today');
      const headerBox = await page.getByTestId('screen-header').boundingBox();
      const pillsBox = await pills.boundingBox();
      expect(pillsBox!.y - (headerBox!.y + headerBox!.height)).toBeLessThan(24);

      // Empty state copy (no "Seller"), smaller circle, slim white pill.
      const empty = page.getByTestId('content-analytics-empty');
      await expect(empty).toContainText('No views yet');
      await expect(empty).toContainText('Post a Thread to see how it performs.');
      expect(await empty.textContent()).not.toMatch(/Seller/);
      // The shared empty-state badge (64px, smaller than the old 96px circle).
      const badge = await page.getByTestId('content-analytics-empty-badge').boundingBox();
      expect(Math.round(badge!.width)).toBe(64);
      const fit = await buttonFit(page, '[data-testid="content-analytics-empty-action"]');
      expect(fit).not.toBeNull();
      expect(fit!.text).toBe('Create post');
      expect(fit!.label!.scrollWidth).toBeLessThanOrEqual(fit!.label!.clientWidth);
      expect(fit!.label!.lines).toBe(1);
      expect(Math.round(fit!.btn.h)).toBe(36);
      const leftPad = fit!.label!.x - fit!.btn.x;
      const rightPad = fit!.btn.right - fit!.label!.right;
      expect(Math.abs(leftPad - rightPad)).toBeLessThanOrEqual(1.5);
      expect(leftPad).toBeGreaterThanOrEqual(12);
      expect(fit!.btn.w).toBeLessThan(200);
      // PressableScale paints the caller's style on its inner view, so read
      // the first opaque background down from the pressable itself.
      const bg = await page.evaluate(() => {
        let el: Element | null = document.querySelector('[data-testid="content-analytics-empty-action"]');
        while (el) {
          const c = getComputedStyle(el).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
          el = el.firstElementChild;
        }
        return '';
      });
      expect(bg.replace(/\s/g, '')).toMatch(/^rgb\(2(4[0-9]|5[0-5]),2(4[0-9]|5[0-5]),2(4[0-9]|5[0-5])\)$/);
      const emptyBox = await empty.boundingBox();
      await page.screenshot({ path: path.join(OUT_DIR, '07-content-analytics-empty-zoom.png'), clip: { x: 0, y: emptyBox!.y - 8, width: 393, height: emptyBox!.height + 16 } });
      await page.screenshot({ path: path.join(OUT_DIR, '07b-create-post-pill-zoom.png'), clip: { x: fit!.btn.x - 12, y: fit!.btn.y - 12, width: fit!.btn.w + 24, height: fit!.btn.h + 24 } });
      await page.screenshot({ path: path.join(OUT_DIR, '08-content-analytics-header-pills-zoom.png'), clip: { x: 0, y: 0, width: 393, height: pillsBox!.y + pillsBox!.height + 8 } });

      // Text-fit guard on every touched region.
      for (const sel of ['[data-testid="screen-header"]', '[data-testid="seller-dashboard-range-pills"]', '[data-testid="content-analytics-empty"]']) {
        const scan = await textFit(page, sel);
        expect(scan.offenders, `${sel}: ${JSON.stringify(scan.offenders)}`).toEqual([]);
      }

      // The pill opens the create screen.
      await page.getByTestId('content-analytics-empty-action').click();
      await page.waitForTimeout(800);
      expect(page.url()).toContain('/create-post');
    } finally {
      await page.close();
    }
  });
});
