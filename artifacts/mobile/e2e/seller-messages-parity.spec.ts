/**
 * "Seller messages = buyer messages" — live verification on the built web
 * preview (static preview build + mocked API; same harness as
 * e2e/header-clearance-sweep.spec.ts) at 393x852.
 *
 * Both sides now render the SAME shared screens
 * (components/inbox/MessagesInbox.tsx, components/chat/ConversationThread.tsx)
 * — this spec opens the buyer and the seller version of each state, checks
 * that the same controls are in the same place, runs Dev's text-fit guard,
 * and writes side-by-side PNGs (buyer left, seller right):
 *
 *  1. Inbox (demo data), Requests tab, search, "+" menu.
 *  2. Empty states (fresh seller inbox / requests; "no results" on both).
 *  3. Thread, thread attach sheet, thread request mode.
 *  4. Seller tab bar: Messages (pushed from Profile) highlights Profile —
 *     never Dashboard/Analytics.
 *
 * Local run (after a dev-mode export of the same preview build):
 *   node -e "import('./scripts/store-screenshots/harness.mjs').then(h=>h.buildPreviewWeb(h.DEV_BUILD_DIR, undefined, { dev: true }))"
 *   pnpm exec playwright test e2e/seller-messages-parity.spec.ts --config e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function loadHarness() {
  return import('../scripts/store-screenshots/harness.mjs') as Promise<{
    DEFAULT_BUILD_DIR: string;
    launchBrowser: () => Promise<any>;
    openContext: (browser: any, opts: any) => Promise<{ context: any; page: any; activity: any }>;
    serveBuild: (buildDir: string) => Promise<{ origin: string; close: () => void }>;
    waitForQuietNetwork: (activity: any, quietMs?: number, timeout?: number) => Promise<void>;
  }>;
}
type Harness = Awaited<ReturnType<typeof loadHarness>>;
type Role = 'buyer' | 'seller';

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 393, height: 852 };
const OUT_DIR = process.env.PARITY_OUT_DIR ?? path.join(process.cwd(), 'e2e', '.seller-messages-parity-out');
mkdirSync(OUT_DIR, { recursive: true });

/**
 * A DEV-mode export (`expo export --dev`, same demo env as
 * buildPreviewWeb) — the preview inbox seeds (lib/previewInbox.ts, shown
 * with ?bt_preview=…&demo=1) only exist when __DEV__ is true. Falls back to
 * the harness's default build.
 */
const BUILD_DIR = process.env.PARITY_BUILD_DIR
  ?? (existsSync(path.join(process.cwd(), '.store-screenshots', 'web-build-dev', 'index.html'))
    ? path.join(process.cwd(), '.store-screenshots', 'web-build-dev')
    : path.join(process.cwd(), '.store-screenshots', 'web-build'));

const ROUTES = {
  buyer: { inbox: '/(buyer)/inbox', thread: '/buyer-conversation' },
  seller: { inbox: '/seller-inbox', thread: '/seller-conversation' },
} as const;

function expectedPath(target: string): string {
  const p = target.split('?')[0].replace(/\/\([^)]+\)/g, '').replace(/\/$/, '');
  return p === '' ? '/' : p;
}

/**
 * Opens a role's shell, waits for it to settle (the auth gate redirects
 * once Clerk resolves), then navigates client-side and verifies the route
 * landed and stayed, retrying if the gate bounced it.
 */
async function openAs(h: Harness, browser: any, origin: string, role: Role, target: string, opts: { demo?: boolean } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: IPHONE_USER_AGENT };
  const fresh = !opts.demo;
  const { page, activity } = await h.openContext(browser, {
    device, role, origin, images: {},
    seedOptions: { fresh }, apiOptions: { fresh },
  });
  const query = `bt_preview=${role}${opts.demo ? '&demo=1' : ''}`;
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.waitForSelector(
    role === 'seller' ? '[data-testid="seller-dashboard-hero-value"]' : '[data-testid="buyer-tab-profile"]',
    { timeout: 25_000 },
  );
  await h.waitForQuietNetwork(activity, 800, 15_000);
  const want = expectedPath(target);
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate((url: string) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}${target.includes('?') ? '&' : '?'}${query}`);
    await page.waitForTimeout(1200);
    if (await page.evaluate(() => location.pathname) === want) break;
  }
  expect(await page.evaluate(() => location.pathname), `${role} navigated to ${target}`).toBe(want);
  await h.waitForQuietNetwork(activity, 1000, 15_000);
  await page.waitForTimeout(900);
  return page;
}


const TEXT_FIT_SCAN = `(() => {
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent && n.textContent.trim()).map((n) => n.textContent).join('');
    if (!ownText || !/[A-Za-z0-9]/.test(ownText)) continue;
    // Conversation previews / names and the IG-style note bubbles are
    // single-line by design (user content, truncated like IG); everything
    // else must fit. (The buyer's own "Your thoughts go here..." note
    // placeholder truncates today — pre-existing buyer UI, left unchanged
    // per Dev's "do not change the buyer side"; flagged in the PR.)
    const truncatable = el.closest('[data-testid^="inbox-conversation-"], [data-testid^="inbox-request-row-"], [data-testid="conversation-header-name"], [data-testid="inbox-my-note"], [data-testid^="inbox-story-tray-"]')
      || style.textOverflow === 'ellipsis' && el.closest('[data-testid*="preview"]');
    if (!truncatable && el.scrollWidth > el.clientWidth + 1) offenders.push({ kind: 'text-overflow', text: ownText.slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    const parent = el.parentElement;
    if (parent) {
      const pStyle = getComputedStyle(parent);
      if (style.position !== 'absolute' && style.position !== 'fixed' && pStyle.overflow !== 'hidden' && pStyle.overflowX !== 'auto' && pStyle.overflowX !== 'scroll') {
        const prect = parent.getBoundingClientRect();
        if (rect.right > prect.right + 1 || rect.left < prect.left - 1) offenders.push({ kind: 'box-overflows-parent', text: ownText.slice(0, 60) });
      }
    }
  }
  return offenders;
})()`;

async function textFit(page: any) {
  return page.evaluate(TEXT_FIT_SCAN) as Promise<Array<Record<string, unknown>>>;
}

/** Box of the first visible element matching a selector. */
async function box(page: any, selector: string) {
  return page.evaluate((sel: string) => {
    const el = Array.from(document.querySelectorAll(sel)).find((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);
}

/**
 * The dev-mode export shows React's dev warning toast (LogBox) for issues on
 * screens visited earlier in the flow (e.g. the dashboard). It is dev-only
 * chrome, never in a real build — removed before each screenshot.
 */
async function shot(page: any): Promise<Buffer> {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const t = el.textContent ?? '';
      if (el.children.length < 40 && /cannot contain a nested|cannot be a descendant|No route named/.test(t)) {
        let node: HTMLElement | null = el;
        while (node && getComputedStyle(node).position !== 'fixed' && node.parentElement !== document.body) node = node.parentElement;
        if (node && node !== document.body) node.style.display = 'none';
      }
    }
  });
  return page.screenshot();
}

/** Writes buyer | seller side by side as one PNG. */
async function sideBySide(browser: any, name: string, buyer: Buffer, seller: Buffer) {
  writeFileSync(path.join(OUT_DIR, `${name}-buyer.png`), buyer);
  writeFileSync(path.join(OUT_DIR, `${name}-seller.png`), seller);
  const ctx = await browser.newContext({ viewport: { width: 393 * 2 + 48, height: 852 + 56 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const img = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  await p.setContent(`<!doctype html><html><body style="margin:0;background:#1a1a1a;font:600 14px Inter,system-ui;color:#bbb">
    <div style="display:flex;gap:16px;padding:12px 16px 0">
      <div style="width:393px;text-align:center">Buyer</div><div style="width:393px;text-align:center">Seller</div>
    </div>
    <div style="display:flex;gap:16px;padding:8px 16px 16px">
      <img src="${img(buyer)}" style="width:393px;height:852px;border-radius:12px">
      <img src="${img(seller)}" style="width:393px;height:852px;border-radius:12px">
    </div></body></html>`);
  await p.waitForTimeout(150);
  writeFileSync(path.join(OUT_DIR, `${name}-side-by-side.png`), await p.screenshot());
  await ctx.close();
}

const report: Record<string, unknown> = {};

test.describe('seller Messages = buyer Messages (393x852)', () => {
  test.describe.configure({ mode: 'serial' });
  let h: Harness;
  let browser: any;
  let server: { origin: string; close: () => void };

  test.beforeAll(async () => {
    h = await loadHarness();
    browser = await h.launchBrowser();
    server = await h.serveBuild(BUILD_DIR);
  });
  test.afterAll(async () => {
    writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    server?.close();
  });

  test('inbox, requests, search and "+" menu render the same on both sides', async () => {
    test.setTimeout(360_000);
    const pages: Record<Role, any> = {
      buyer: await openAs(h, browser, server.origin, 'buyer', ROUTES.buyer.inbox, { demo: true }),
      seller: await openAs(h, browser, server.origin, 'seller', ROUTES.seller.inbox, { demo: true }),
    };
    const shots: Record<string, Partial<Record<Role, Buffer>>> = {};
    const layout: Record<string, Partial<Record<Role, unknown>>> = {};
    for (const role of ['buyer', 'seller'] as Role[]) {
      const page = pages[role];
      // Same controls, same place.
      for (const sel of ['[data-testid="inbox-header-search"]', '[data-testid="inbox-header-compose"]', '[data-testid="inbox-tab-inbox"]', '[data-testid="inbox-tab-requests"]']) {
        (layout[sel] ??= {})[role] = await box(page, sel);
        expect(layout[sel][role], `${role}: ${sel}`).not.toBeNull();
      }
      (layout.back ??= {})[role] = await box(page, '[data-testid="tab-page-header-back"]');
      (layout.filter ??= {})[role] = await box(page, '[data-testid="inbox-filter-pill"]');
      const fit = await textFit(page);
      expect(fit, `${role} inbox text fit`).toEqual([]);
      (shots.inbox ??= {})[role] = await shot(page);

      await page.click('[data-testid="inbox-tab-requests"]', { timeout: 10_000 });
      await page.waitForTimeout(1800);
      expect(await textFit(page), `${role} requests text fit`).toEqual([]);
      (shots.requests ??= {})[role] = await shot(page);
      await page.click('[data-testid="inbox-tab-inbox"]', { timeout: 10_000 });
      await page.waitForTimeout(500);

      await page.click('[data-testid="inbox-header-search"]', { timeout: 10_000 });
      await page.waitForTimeout(500);
      await page.keyboard.type('a');
      await page.waitForTimeout(600);
      expect(await textFit(page), `${role} search text fit`).toEqual([]);
      (shots.search ??= {})[role] = await shot(page);
      await page.keyboard.type('zzqq');
      await page.waitForTimeout(600);
      (shots['search-no-results'] ??= {})[role] = await shot(page);
      await page.getByText('Cancel', { exact: true }).first().click({ timeout: 8000 });
      await page.waitForTimeout(600);

      await page.click('[data-testid="inbox-header-compose"]', { timeout: 10_000 });
      await page.waitForTimeout(800);
      expect(await textFit(page), `${role} "+" menu text fit`).toEqual([]);
      (shots['compose-menu'] ??= {})[role] = await shot(page);
      await page.getByText('Cancel', { exact: true }).last().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    report.inboxLayout = layout;

    // Identical placement for every shared control (buyer vs seller).
    // The one intentional difference: the buyer's filter pill (a "Message
    // filters — coming soon" snackbar today) is left off the seller side —
    // Dev's rules forbid shipping a "coming soon" control. The Inbox /
    // Requests pills therefore start one pill-width further left.
    const filter = layout.filter as Record<Role, { x: number; w: number } | null>;
    expect(filter.buyer).not.toBeNull();
    expect(filter.seller).toBeNull();
    const filterShift = filter.buyer!.w + (layout['[data-testid="inbox-tab-inbox"]'].buyer as { x: number }).x - (filter.buyer!.x + filter.buyer!.w);
    for (const sel of ['[data-testid="inbox-header-search"]', '[data-testid="inbox-header-compose"]', '[data-testid="inbox-tab-inbox"]', '[data-testid="inbox-tab-requests"]']) {
      const b = layout[sel].buyer as { x: number; y: number; w: number; h: number };
      const s = layout[sel].seller as { x: number; y: number; w: number; h: number };
      const shift = sel.includes('inbox-tab-') ? filterShift : 0;
      expect(Math.abs(b.x - shift - s.x), `${sel} x`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.w - s.w), `${sel} w`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y - s.y), `${sel} y`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.h - s.h), `${sel} h`).toBeLessThanOrEqual(1);
    }
    // The seller's Messages is pushed (bare back arrow); the buyer tab page has none.
    expect(layout.back.buyer).toBeNull();
    expect(layout.back.seller).not.toBeNull();

    for (const [name, pair] of Object.entries(shots)) await sideBySide(browser, name, pair.buyer!, pair.seller!);
    await pages.buyer.context().close();
    await pages.seller.context().close();
  });

  test('seller empty states (fresh store) use the shared inbox layout', async () => {
    test.setTimeout(120_000);
    const page = await openAs(h, browser, server.origin, 'seller', ROUTES.seller.inbox);
    await expect(page.getByText('No messages yet', { exact: true })).toBeVisible();
    await expect(page.getByText('Messages from buyers show up here', { exact: true })).toBeVisible();
    expect(await textFit(page), 'empty inbox text fit').toEqual([]);
    writeFileSync(path.join(OUT_DIR, 'empty-inbox-seller.png'), await shot(page));
    await page.click('[data-testid="inbox-tab-requests"]', { timeout: 10_000 });
    await page.waitForTimeout(700);
    await expect(page.getByText('No message requests', { exact: true })).toBeVisible();
    expect(await textFit(page), 'empty requests text fit').toEqual([]);
    writeFileSync(path.join(OUT_DIR, 'empty-requests-seller.png'), await shot(page));
    await page.context().close();
  });

  test('thread, attach sheet and request mode render the same on both sides', async () => {
    test.setTimeout(360_000);
    const shots: Record<string, Partial<Record<Role, Buffer>>> = {};
    const layout: Record<string, Partial<Record<Role, unknown>>> = {};
    for (const role of ['buyer', 'seller'] as Role[]) {
      const page = await openAs(h, browser, server.origin, role, ROUTES[role].inbox, { demo: true });
      // Open the first ordinary conversation row.
      // (The buyer's pinned Brandthread Agent thread is an AI account with no
      // call icons — open the first ordinary person-to-person thread.)
      const firstRow = page.locator('[data-testid^="inbox-conversation-"]')
        .filter({ hasNot: page.locator('[data-testid^="inbox-official-badge-"]') }).first();
      await firstRow.click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => location.pathname)).toBe(expectedPath(ROUTES[role].thread));
      for (const sel of ['[data-testid="conversation-back"]', '[data-testid="conversation-header-name"]', '[data-testid="conversation-call-voice"]', '[data-testid="conversation-call-video"]', '[data-testid="conversation-options"]', '[data-testid="conversation-attach"]', '[data-testid="conversation-mic"]', '[data-testid="conversation-gallery"]']) {
        (layout[sel] ??= {})[role] = await box(page, sel);
        expect(layout[sel][role], `${role}: ${sel}`).not.toBeNull();
      }
      expect(await textFit(page), `${role} thread text fit`).toEqual([]);
      (shots.thread ??= {})[role] = await shot(page);

      await page.click('[data-testid="conversation-attach"]', { timeout: 10_000 });
      await page.waitForTimeout(800);
      expect(await textFit(page), `${role} attach sheet text fit`).toEqual([]);
      (shots['thread-attach-sheet'] ??= {})[role] = await shot(page);
      // Close the sheet (RN-web Modal: Escape → onRequestClose).
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);

      await page.click('[data-testid="conversation-options"]', { timeout: 10_000 });
      await page.waitForTimeout(800);
      expect(await textFit(page), `${role} options sheet text fit`).toEqual([]);
      (shots['thread-options'] ??= {})[role] = await shot(page);
      await page.getByText('Cancel', { exact: true }).last().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Request mode: back to the inbox, Requests tab, first request.
      await page.click('[data-testid="conversation-back"]', { timeout: 10_000 });
      await page.waitForTimeout(1000);
      await page.click('[data-testid="inbox-tab-requests"]', { timeout: 10_000 });
      await page.waitForTimeout(1500);
      await page.locator('[data-testid^="inbox-request-row-"]').first().click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      expect(await textFit(page), `${role} request thread text fit`).toEqual([]);
      // Block / Delete / Accept: three EQUAL buttons, same height, labels fit
      // with >= 12px padding.
      const panel = await page.evaluate(() => ['block', 'delete', 'accept'].map((k) => {
        const b = document.querySelector(`[data-testid="conversation-request-${k}"]`) as HTMLElement;
        const label = Array.from(b.querySelectorAll('*')).find((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && /[A-Za-z]/.test(n.textContent ?? ''))) as HTMLElement;
        const r = b.getBoundingClientRect();
        const l = label.getBoundingClientRect();
        return { w: r.width, h: r.height, padL: l.left - r.left, padR: r.right - l.right };
      }));
      (layout.requestPanel ??= {})[role] = panel;
      for (const btn of panel) {
        expect(Math.abs(btn.w - panel[0].w), `${role} request buttons equal width`).toBeLessThanOrEqual(1);
        expect(Math.abs(btn.h - panel[0].h), `${role} request buttons equal height`).toBeLessThanOrEqual(1);
        expect(Math.min(btn.padL, btn.padR), `${role} request button padding`).toBeGreaterThanOrEqual(12);
      }
      (shots['thread-request'] ??= {})[role] = await shot(page);
      await page.context().close();
    }
    report.threadLayout = layout;
    for (const sel of Object.keys(layout).filter((k) => k.startsWith('['))) {
      const b = layout[sel].buyer as { x: number; y: number; w: number; h: number };
      const s = layout[sel].seller as { x: number; y: number; w: number; h: number };
      expect(Math.abs(b.y - s.y), `${sel} y`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.h - s.h), `${sel} h`).toBeLessThanOrEqual(1);
      if (sel !== '[data-testid="conversation-header-name"]') expect(Math.abs(b.x - s.x), `${sel} x`).toBeLessThanOrEqual(1);
    }
    for (const [name, pair] of Object.entries(shots)) {
      if (pair.buyer && pair.seller) await sideBySide(browser, name, pair.buyer, pair.seller);
    }
  });

  test('seller-only data: a request the seller sent keeps the composer; "Orders from <buyer>" sheet', async () => {
    test.setTimeout(180_000);
    const page = await openAs(h, browser, server.origin, 'seller', ROUTES.seller.inbox, { demo: true });
    // The request the seller SENT (the second seeded request).
    await page.click('[data-testid="inbox-tab-requests"]', { timeout: 10_000 });
    await page.waitForTimeout(1500);
    await page.locator('[data-testid^="inbox-request-row-"]').nth(1).click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="conversation-sent-request-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="conversation-request-panel"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="conversation-input"]').first()).toBeVisible();
    expect(await textFit(page), 'sent request text fit').toEqual([]);
    writeFileSync(path.join(OUT_DIR, 'thread-sent-request-seller.png'), await shot(page));
    await page.click('[data-testid="conversation-back"]', { timeout: 10_000 });
    await page.waitForTimeout(1000);

    // An ordinary thread: options → "Orders from <buyer>".
    await page.click('[data-testid="inbox-tab-inbox"]', { timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.locator('[data-testid^="inbox-conversation-"]').first().click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await page.click('[data-testid="conversation-options"]', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.getByText(/^Orders from /).first().click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-testid="conversation-buyer-orders"]')).toBeVisible();
    expect(await textFit(page), 'orders sheet text fit').toEqual([]);
    writeFileSync(path.join(OUT_DIR, 'thread-buyer-orders-seller.png'), await shot(page));
    await page.context().close();
  });

  test('seller tab bar: Messages (from Profile) highlights Profile, not Dashboard', async () => {
    test.setTimeout(120_000);
    const page = await openAs(h, browser, server.origin, 'seller', '/(tabs)/profile');
    await page.waitForSelector('[data-testid="seller-global-tab-bar"]', { timeout: 20_000 });
    await page.click('[data-testid="profile-messages-btn"]', { timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => location.pathname)).toBe('/seller-inbox');
    const selected = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="seller-tab-"][aria-selected="true"]')).map((e) => e.getAttribute('data-testid')));
    report.tabBarSelectedOnMessages = selected;
    expect(selected).toEqual(['seller-tab-profile']);
    writeFileSync(path.join(OUT_DIR, 'tab-bar-messages-seller.png'), await shot(page));
    await page.context().close();
  });
});
