#!/usr/bin/env node
/**
 * Seller Orders tab + order detail at 390x844 @2x (items 75-78), demo and fresh.
 *   node scripts/seller-orders-less-ai-screenshots.mjs <outDir> [--root <mobileDir>] [--late <file.json>]
 *
 * --root builds another checkout (e.g. a worktree of origin/dev for BEFORE
 * shots) with this harness. The AFTER run records which demo order is late
 * (by its "Late" tag) into --late; a BEFORE run reads it so both runs show
 * the same order. Ends with a text-fit check on every screen it captures.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, WORK_DIR, buildPreviewWeb, serveBuild, launchBrowser, openContext, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : path.join(MOBILE_ROOT, '../../docs/pr-assets/seller-orders/after'));
const ROOT = path.resolve(flag('--root') ?? MOBILE_ROOT);
const LATE_FILE = path.resolve(flag('--late') ?? path.join(WORK_DIR, 'seller-orders-late.json'));
const BUILD_DIR = path.join(WORK_DIR, `web-build-${path.basename(path.dirname(path.dirname(ROOT)))}`);
mkdirSync(OUT, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb(BUILD_DIR, ROOT);
const server = await serveBuild(BUILD_DIR);
const browser = await launchBrowser();
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };

const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, name) }); console.log('ok', name); };

/** Text-fit check: clipped text, text wider than its box, boxes spilling out of their parent or off screen. */
async function fitCheck(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    const scroller = (el) => { for (let p = el; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const name = `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 40)}`;
      if (own && el.scrollWidth > el.clientWidth + 1 && !scroller(el)) out.push(`text clipped ${name} (${el.scrollWidth}>${el.clientWidth})`);
      if (own && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis ${name}`);
      const p = el.parentElement;
      if (own && p && !scroller(el)) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1)) out.push(`overflows parent ${name}`);
      }
      if (own && !scroller(el) && (r.right > vw + 1 || r.left < -1)) out.push(`off screen ${name}`);
    }
    return out;
  });
  console.log(problems.length ? `FIT FAIL ${label}:\n  ${problems.join('\n  ')}` : `fit ok ${label}`);
  if (problems.length) process.exitCode = 1;
}

/**
 * Loads the screen as the FIRST page load (not a client-side push): the
 * Orders tab and order detail read `demo=1` from the URL when they load, and
 * a pushState / tab tap drops the query string.
 */
async function open(target, demo) {
  const ctx = await openContext(browser, { device, role: 'seller', origin: server.origin, images: {} });
  ctx.page.setDefaultNavigationTimeout(240_000);
  const query = `bt_preview=seller${demo ? '&demo=1' : ''}`;
  await ctx.page.goto(`${server.origin}${target}${target.includes('?') ? '&' : '?'}${query}`);
  await ctx.page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 30_000 });
  await waitForQuietNetwork(ctx.activity, 900, 20_000);
  await ctx.page.waitForTimeout(3000);
  return ctx;
}

const scrollTo = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));

try {
  // ── Demo: orders list ──
  const list = await open('/orders', true);
  await shot(list.page, '01-orders-list-demo.png');
  await fitCheck(list.page, 'orders list demo (top)');

  let late = existsSync(LATE_FILE) ? JSON.parse(readFileSync(LATE_FILE, 'utf8')) : null;
  const lateTag = list.page.locator('[data-testid^="order-status-"][data-testid$="-late"]').first();
  const target = () => (late?.orderNumber && !process.env.RECORD_LATE
    ? list.page.getByText(late.orderNumber, { exact: true }).first()
    : lateTag);
  // The list is virtualised: wheel down until the row is rendered.
  for (let i = 0; i < 25 && !(await target().count()); i += 1) {
    await list.page.mouse.move(195, 500);
    await list.page.mouse.wheel(0, 700);
    await list.page.waitForTimeout(350);
  }
  if (await lateTag.count() && (!late || process.env.RECORD_LATE)) {
    const testId = await lateTag.getAttribute('data-testid');
    const id = testId.replace(/^order-status-/, '').replace(/-late$/, '');
    const orderNumber = await lateTag.evaluate((el) => {
      for (let p = el; p; p = p.parentElement) { const m = /BT-\d+/.exec(p.textContent || ''); if (m) return m[0]; }
      return null;
    });
    late = { id, orderNumber };
    writeFileSync(LATE_FILE, JSON.stringify(late));
  }
  if (await target().count()) await scrollTo(target());
  console.log('late order', late);
  await shot(list.page, '02-orders-list-late-demo.png');
  await fitCheck(list.page, 'orders list demo (late row)');
  await list.context.close();

  // ── Demo: order detail of the late order ──
  if (late?.id) {
    const detail = await open(`/order-detail?id=${encodeURIComponent(late.id)}`, true);
    await shot(detail.page, '03-order-detail-top-demo.png');
    await fitCheck(detail.page, 'order detail top');
    const receipt = detail.page.getByTestId('order-receipt');
    if (await receipt.count()) {
      await scrollTo(receipt);
      await shot(detail.page, '04-order-detail-receipt-demo.png');
      await fitCheck(detail.page, 'order detail receipt');
    }
    // Payment tab (before: where the money lived; after: same receipt + paid/held rows).
    const paymentTab = detail.page.getByRole('tab', { name: 'Payment' }).or(detail.page.getByText('Payment', { exact: true })).first();
    await paymentTab.click();
    await detail.page.waitForTimeout(800);
    await detail.page.evaluate(() => window.scrollTo(0, 0));
    await shot(detail.page, '05-order-detail-payment-tab-demo.png');
    await fitCheck(detail.page, 'order detail payment tab');
    await detail.context.close();
  }

  // ── Fresh (no demo): honest empty list, no invented orders ──
  const fresh = await open('/orders', false);
  await shot(fresh.page, '06-orders-list-fresh.png');
  await fitCheck(fresh.page, 'orders list fresh');
  await fresh.context.close();
} finally {
  await browser.close();
  server.close();
}
