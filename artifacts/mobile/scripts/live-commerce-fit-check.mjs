#!/usr/bin/env node
/**
 * Text-fit & alignment check for the live-commerce screens at 393x852.
 * Fails (exit 1) when, on any checked screen state:
 *   - a text element has scrollWidth > clientWidth (clipped text) or uses
 *     text-overflow: ellipsis / line-clamp;
 *   - a text element's box overflows its parent's box (outside any
 *     horizontally scrolling container);
 *   - buttons that share a row differ in height or width;
 *   - the browser logged a console error (includes React nested-<button>
 *     DOM-nesting warnings) or a page error.
 * Also saves zoomed element screenshots of every card and button group.
 *
 *   node scripts/live-commerce-fit-check.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude-live-commerce-pin-codes-schedule/fit');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Runs in the page: returns a list of human-readable problems. */
function auditDom(rootSelector) {
  const problems = [];
  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return [`audit root not found: ${rootSelector}`];
  const describe = (el) => `${el.tagName.toLowerCase()}"${(el.innerText || el.textContent || '').trim().slice(0, 40)}"`;
  const scrollsX = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const textEls = [...root.querySelectorAll('*')].filter((el) => {
    if (el.children.length > 0 && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
    return (el.innerText || '').trim().length > 0 && el.getClientRects().length > 0;
  });
  for (const el of textEls) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') problems.push(`clipped text: ${describe(el)}`);
    if ((cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      problems.push(`truncated text: ${describe(el)}`);
    }
    const parent = el.parentElement;
    if (parent && !scrollsX(el)) {
      const a = el.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      if (a.width > 0 && (a.left < b.left - 1 || a.right > b.right + 1)) problems.push(`overflows parent: ${describe(el)}`);
    }
  }
  // Buttons in the same row must match in height and width.
  const buttons = [...root.querySelectorAll('[role="button"], button')].filter((b) => b.getClientRects().length && (b.innerText || '').trim());
  const rows = new Map();
  for (const b of buttons) {
    const r = b.getBoundingClientRect();
    if (r.width > 340 || scrollsX(b)) continue;
    const key = `${b.parentElement?.parentElement?.className}|${Math.round(r.top / 4)}`;
    rows.set(key, [...(rows.get(key) ?? []), { b, r }]);
  }
  for (const group of rows.values()) {
    if (group.length < 2) continue;
    const heights = new Set(group.map((g) => Math.round(g.r.height)));
    const widths = new Set(group.map((g) => Math.round(g.r.width)));
    if (heights.size > 1) problems.push(`unequal button heights in a row: ${group.map((g) => describe(g.b)).join(', ')}`);
    if (widths.size > 1) problems.push(`unequal button widths in a row: ${group.map((g) => describe(g.b)).join(', ')}`);
  }
  return problems;
}

const failures = [];

async function open(browser, origin, role, target, { demo = false, mine = [] } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images: {} });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  await context.route('**/live/scheduled/**', async (route) => {
    const cors = {
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ scheduled: mine }) });
  });
  await openScreen(page, activity, origin, role, target, {
    beforeNavigate: async () => { if (demo) await page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')); },
  });
  await page.waitForTimeout(2000);
  // The seller gate can land on Home first; re-push the target until it shows.
  const marker = target === '/seller-schedule-live' ? page.getByPlaceholder('Title') : page.getByTestId('live-screen');
  for (let i = 0; i < 4 && !(await marker.first().isVisible().catch(() => false)); i++) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}?bt_preview=${role}`);
    await page.waitForTimeout(2500);
  }
  return { context, page, errors };
}

async function check(name, page, errors, rootSelector) {
  const problems = await page.evaluate(auditDom, rootSelector ?? null);
  // The preview's bundled clips are not decodable in this headless browser.
  const realErrors = errors.filter((e) => !/no supported source/i.test(e) && !/Failed to load resource/i.test(e));
  for (const p of [...problems, ...realErrors]) failures.push(`${name}: ${p}`);
  console.log(`${problems.length + realErrors.length === 0 ? 'PASS' : 'FAIL'} ${name}`);
  for (const p of [...problems, ...realErrors]) console.log(`   - ${p}`);
}

async function zoom(page, locator, file) {
  try { await locator.first().screenshot({ path: path.join(OUT, `${file}.png`) }); } catch { /* element absent */ }
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const startsAt = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
    const mine = [{
      id: 'demo-1', sellerId: 'seller', title: 'Fall collection drop with a deliberately long title', description: null, startsAt,
      productTags: [], reminderCount: 1, reminderSet: false,
      seller: { name: 'Seller', username: null, avatarUrl: null, verified: false },
    }];

    let s = await open(browser, origin, 'seller', '/seller-schedule-live', { mine });
    await check('schedule: empty form + scheduled card', s.page, s.errors);
    await zoom(s.page, s.page.getByTestId('scheduled-demo-1'), 'schedule-card');
    await zoom(s.page, s.page.getByRole('button', { name: 'Schedule live' }), 'schedule-button');
    await s.page.getByPlaceholder('Title').fill('Winter capsule preview');
    await s.page.getByText('7:00 PM', { exact: true }).first().click();
    await s.page.getByRole('button', { name: 'Products' }).click();
    await check('schedule: filled + products open', s.page, s.errors);
    await s.context.close();

    s = await open(browser, origin, 'buyer', '/live', { demo: true });
    await s.page.getByTestId('live-pinned-product').first().waitFor({ timeout: 20000 }).catch(() => console.log('  pinned card not visible; testids:', 0));
    await check('viewer pager: pinned card', s.page, s.errors, '[data-testid="live-pinned-product"]');
    await zoom(s.page, s.page.getByTestId('live-pinned-product'), 'viewer-pinned-card');
    await s.page.getByRole('button', { name: /Open bag|shop|products/i }).first().click().catch(() => {});
    await s.page.waitForTimeout(800);
    await check('viewer pager: bag sheet', s.page, s.errors, '[data-testid="live-products-sheet"]');
    await zoom(s.page, s.page.getByTestId('live-products-sheet'), 'viewer-bag-sheet');
    await s.context.close();
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):\n- ${[...new Set(failures)].join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nFit check clean.');
}
run().catch((e) => { console.error(e); process.exit(1); });
