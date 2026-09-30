/**
 * Shared browser session for the back-navigation click-path suite.
 *
 * Every helper here drives the REAL web build through real pointer clicks (no
 * pushState tricks, no router calls from test code), at the 393x852 phone
 * viewport, in the same `?bt_preview=seller|buyer[&demo=1]` mode the design
 * preview uses. The Clerk SDK is stubbed (a signed-in account exists, exactly
 * like the preview on a dev machine) but the API is NEVER answered with data:
 * every call is recorded and gets a 401, so a screen that leans on a protected
 * API inside preview shows up in `session.apiCalls`.
 */
import { readFileSync } from 'node:fs';
import { clerkStubScript } from '../../store-screenshots/clerk-stub.mjs';
import { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, IMAGE_HOST, SELLER_USER, localStorageSeed, respond } from '../../store-screenshots/demo-data.mjs';

export const VIEWPORT = { width: 393, height: 852 };
const DEMO_API = 'https://api.brandthread.test';

/** Everything that can be pressed. RN-Web tags Pressables with data-focusable + tabindex. */
export const TAPPABLE = '[role=button],[role=link],[role=tab],[role=menuitem],a[href],[data-focusable=true],[tabindex="0"]';

/** Tab-bar chrome: switching tabs is covered by the dedicated tab scenarios, not the row crawl. */
const CHROME_TESTIDS = /^(seller-tab-|seller-bottom-|seller-global-tab-bar|buyer-tab-|buyer-bottom-|brandthread-logo|expo-go-)/;
/** Things that would sign the demo user out, delete data, leave the app or open a native picker. */
export const DANGEROUS_NAME = /^save\b|^submit\b|sign ?out|log ?out|delete|remove account|deactivate|switch (to|account)|add account|accept all|necessary only|customize|cookie|camera|take photo|choose from|upload|download|share|copy|call |start (a )?(live|call)|go live/i;
export const BACK_NAME = /^(go back|back|close|cancel|dismiss|done)\b/i;

export function normalizeUrl(urlOrPath) {
  const u = new URL(urlOrPath, 'http://x');
  u.searchParams.delete('bt_preview');
  u.searchParams.delete('demo');
  const search = [...u.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&');
  return u.pathname.replace(/\/$/, '') + (search ? `?${search}` : '') || '/';
}

export async function openSession(browser, { origin, role, demo, api = 'blocked', images = {}, clerk = process.env.BACK_NAV_CLERK || 'stub' }) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: Number(process.env.DSF || 1), isMobile: true, hasTouch: false,
    locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce',
  });
  const user = role === 'seller' ? SELLER_USER : BUYER_USER;
  // 'stub': a signed-in account exists (Clerk stubbed); 'none': no account at all (Clerk never loads), the truest "preview".
  if (clerk === 'stub') await context.addInitScript(clerkStubScript(user));
  // Only the cookie banner / feature flags are pre-seeded. Role + demo come from the URL exactly like a real preview load.
  const seed = localStorageSeed(role, { fresh: true });
  const keep = { 'bt:cookie-consent': seed['bt:cookie-consent'], 'bt:feature-flags:v1': seed['bt:feature-flags:v1'] };
  await context.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
  }, keep);
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '#error-toast,#error-overlay{display:none!important}*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important;caret-color:transparent!important}';
      document.head.appendChild(s);
    });
  });
  const session = { context, origin, role, demo, clerk, apiCalls: new Set(), jsErrors: new Set(), consoleErrors: [], lastApiAt: Date.now() };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === IMAGE_HOST) {
      const file = images[url.pathname.split('/').pop().replace(/\.jpg$/, '')];
      return file ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(file) }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.origin === DEMO_API) {
      const cors = {
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      session.lastApiAt = Date.now();
      if (api === 'fake') {
        const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role, options: {} });
        if (body !== undefined) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      }
      session.apiCalls.add(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":{"code":"UNAUTHORIZED","message":"preview"}}' });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/GO_BACK|was not handled by any navigator|Maximum update depth/.test(text)) session.consoleErrors.push(text.slice(0, 160));
    if (!/Failed to load resource|net::ERR|clerk|Clerk|401|favicon|WebSocket connection/i.test(text)) session.jsErrors.add(text.replace(/\s+/g, ' ').slice(0, 200));
  });
  page.on('pageerror', (e) => { if (/GO_BACK|was not handled/.test(e.message)) session.consoleErrors.push(e.message.slice(0, 160)); });
  session.page = page;
  session.close = () => context.close();
  return session;
}

export function previewQuery(session) {
  return `bt_preview=${session.role}${session.demo ? '&demo=1' : ''}`;
}

export async function settle(page, ms = 600) {
  await page.waitForTimeout(ms);
}

/** Cold load. Used for seeds and for "fresh deep link" scenarios. */
export async function coldLoad(session, pathAndQuery = '/') {
  const { page } = session;
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  await page.goto(`${session.origin}${pathAndQuery}${sep}${previewQuery(session)}`);
  if (session.clerk === 'stub') await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
  await page.waitForSelector(`${TAPPABLE}`, { timeout: 20_000 }).catch(() => {});
  await settle(page, 1500);
}

export const readPath = (page) => page.evaluate(() => location.pathname + location.search);

/**
 * Lists everything pressable and visible with a point that genuinely hits it.
 * `scopeToDialog` narrows to an open modal/sheet (RN-Web portals it).
 */
export function enumerateTappables(page) {
  return page.evaluate(([sel, chromeRe, vw, vh]) => {
    const chrome = new RegExp(chromeRe);
    const all = [...document.querySelectorAll(sel)];
    const dialog = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].filter((d) => d.getBoundingClientRect().height > 40).pop();
    const out = [];
    const seen = new Set();
    for (const el of all) {
      if (dialog && !dialog.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) continue;
      const testid = el.getAttribute('data-testid') || '';
      if (chrome.test(testid) || el.closest('[data-testid^="seller-global-tab-bar"],[data-testid^="buyer-bottom-tab-bar"]')) continue;
      let hit = null;
      const xs = [0.5, 0.25, 0.75, 0.1, 0.9];
      const ys = [0.5, 0.25, 0.75, 0.1, 0.9];
      outer: for (const fy of ys) for (const fx of xs) {
        const x = Math.min(vw - 1, Math.max(1, r.left + r.width * fx));
        const y = Math.min(vh - 1, Math.max(1, r.top + r.height * fy));
        const t = document.elementFromPoint(x, y);
        if (t && (t === el || el.contains(t)) && t.closest(sel) === el) { hit = { x, y }; break outer; }
      }
      if (!hit) continue;
      const aria = el.getAttribute('aria-label');
      const text = (aria || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const name = text || testid || '(unnamed)';
      out.push({ name, testid, x: hit.x, y: hit.y, top: r.top, w: r.width, h: r.height, role: el.getAttribute('role') || '' });
      seen.add(el);
    }
    return { items: out, dialog: !!dialog };
  }, [TAPPABLE, CHROME_TESTIDS.source, VIEWPORT.width, VIEWPORT.height]);
}

/** Visible state of a screen: where we are, what header says, sheet open, selected chips, list scroll. */
export function fingerprint(page) {
  return page.evaluate(() => {
    const url = location.pathname + location.search;
    // Inactive tab screens stay mounted (detachInactiveScreens=false), so take the title that is actually on top and on screen.
    const title = [...document.querySelectorAll('[data-testid="screen-header-title"]')].find((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) return false;
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(1, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(1, r.top + r.height / 2)));
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    })?.textContent?.trim() || '';
    const dialogOpen = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].some((d) => d.getBoundingClientRect().height > 40);
    const selected = [...document.querySelectorAll('[aria-selected=true],[aria-pressed=true],[aria-checked=true],[aria-current=page]')]
      .map((e) => (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean).sort().join('|');
    const scrollers = [...document.querySelectorAll('div')].filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4 && r.width > 200 && r.height > 200 && r.bottom > 0 && r.top < innerHeight;
    }).sort((a, b) => b.scrollHeight - a.scrollHeight);
    const body = document.body.innerText || '';
    const broken = /This screen doesn.t exist|Unmatched Route|Something went wrong/i.test(body);
    const dialogEl = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].filter((d) => d.getBoundingClientRect().height > 40).pop();
    const dialogText = dialogEl ? (dialogEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return { url, title, dialogOpen, dialogText, selected, scroll: Math.round(scrollers[0]?.scrollTop ?? 0), broken };
  });
}

export async function scrollMain(page, dy) {
  await page.mouse.move(196, 400);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(350);
}

/** The visible on-screen back/close/cancel control, if any. */
export async function findBackControl(page) {
  const byTestId = page.locator('[data-testid="screen-header-back"]:visible');
  if (await byTestId.count()) return { locator: byTestId.last(), label: 'header back' };
  const { items } = await enumerateTappables(page);
  // A real back control has a short, back-ish accessible name. Long names that merely contain "back" ("Check back soon") are content.
  const isBack = (i) => i.name.length <= 40 && /^(go back|back|close|cancel|dismiss|done)\b/i.test(i.name);
  const cand = items.filter((i) => isBack(i) && i.top < 150).sort((a, b) => a.x - b.x)[0]
    || items.filter(isBack).sort((a, b) => a.top - b.top)[0];
  if (cand) return { point: cand, label: cand.name };
  // An icon-only control in the top-left corner with no accessible name is still what a person taps to go back - but it is a bug.
  const bare = items.filter((i) => i.name === '(unnamed)' && i.top < 140 && i.x < 90 && i.w <= 64).sort((a, b) => a.top - b.top)[0];
  if (bare) return { point: bare, label: '(unlabeled back icon)' };
  return null;
}

/** First-run coach overlays ("Tap to continue") cover the whole screen until tapped; a person taps through them once. */
export async function dismissCoachMarks(page) {
  for (let i = 0; i < 3; i += 1) {
    const guide = page.locator('[data-testid$="gesture-guide"]:visible').first();
    if (!(await guide.count())) return;
    const box = await guide.boundingBox().catch(() => null);
    if (!box) return;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
  }
}

export async function pressBack(page, waitMs = 2500) {
  await dismissCoachMarks(page);
  // A freshly pushed screen can take a moment to render its header; only call the control missing after a fair wait.
  let c = await findBackControl(page);
  for (let waited = 0; !c && waited < waitMs; waited += 250) {
    await page.waitForTimeout(250);
    c = await findBackControl(page);
  }
  if (!c) return null;
  if (c.locator) {
    // A real tap lands on whatever is on top at that spot, so click the coordinates instead of waiting for actionability.
    const box = await c.locator.boundingBox({ timeout: 4000 });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else await page.mouse.click(c.point.x, c.point.y);
  return c.label;
}

export async function tap(page, item) {
  await page.mouse.click(item.x, item.y);
}

/** Taps the n-th visible tappable named `name` (used to replay a recorded tap path). */
export async function tapByName(page, name, nth = 0) {
  const { items } = await enumerateTappables(page);
  const matches = items.filter((i) => i.name === name);
  const item = matches[nth] ?? matches[0];
  if (!item) return false;
  await tap(page, item);
  return true;
}

export const sameScreen = (a, b, { scrollTolerance = 80, checkScroll = false } = {}) => {
  if (normalizeUrl(a.url) !== normalizeUrl(b.url)) return `url ${normalizeUrl(a.url)} != ${normalizeUrl(b.url)}`;
  if (a.title !== b.title) return `title "${a.title}" != "${b.title}"`;
  if (a.dialogOpen !== b.dialogOpen) return `sheet open ${a.dialogOpen} != ${b.dialogOpen}`;
  if (a.selected !== b.selected) return `selection "${a.selected}" != "${b.selected}"`;
  if (checkScroll && Math.abs(a.scroll - b.scroll) > scrollTolerance) return `scroll ${a.scroll} != ${b.scroll}`;
  return null;
};
