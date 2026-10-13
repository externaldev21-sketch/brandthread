#!/usr/bin/env node
/**
 * Seller dashboard "look less AI" pass (items 65–74) — before/after captures
 * at 390x844 (scale 2), in fresh (`?bt_preview=seller`) and demo (`&demo=1`)
 * preview modes: dashboard top, scrolled sections, the chart scrub bubble and
 * every range. Also runs a text-fit check on each screen.
 *
 *   node scripts/seller-dashboard-less-ai-screenshots.mjs <outDir> [before|after]
 *
 * SKIP_BUILD=1 reuses the existing preview build.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, DEFAULT_BUILD_DIR, buildPreviewWeb, serveBuild, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/seller-dashboard/after'));
const PHASE = process.argv[3] ?? 'after';
const RANGES = PHASE === 'before'
  ? ['Today', 'Week', 'Month', 'Year', 'All']
  : ['Today', '7D', '30D', '90D'];
mkdirSync(OUT, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const errors = [];

const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, name) }); console.log('ok', name); };

/** Text-fit check: truncated/clipped text, text wider than its box, boxes spilling out of their parent. */
async function fitCheck(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    const scroller = (el) => { for (let p = el; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const name = `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 40)}`;
      if (own && el.scrollWidth > el.clientWidth + 1 && !scroller(el)) out.push(`text clipped ${name} (${el.scrollWidth}>${el.clientWidth})`);
      if (own && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis ${name}`);
      if (own && !scroller(el) && (r.right > vw + 1 || r.left < -1)) out.push(`off screen ${name}`);
    }
    return out;
  });
  console.log(problems.length ? `FIT FAIL ${label}:\n  ${problems.join('\n  ')}` : `fit ok ${label}`);
  if (problems.length) process.exitCode = 1;
}

async function scrollDashboard(page, y) {
  await page.evaluate((top) => {
    // The ScrollView's testID can sit on a wrapper; scroll whichever node
    // (it or a descendant/ancestor) actually overflows vertically.
    const root = document.querySelector('[data-testid="seller-dashboard-scroll"]');
    if (!root) return;
    const canScroll = (el) => el && el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
    let target = null;
    for (let p = root; p && !target; p = p.parentElement) if (canScroll(p)) target = p;
    if (!target) target = [...root.querySelectorAll('*')].find(canScroll) ?? null;
    // Plain scrollTop assignment: scrollTo() is a no-op under the harness's fake clock.
    (target ?? document.scrollingElement).scrollTop = top;
  }, y);
  await page.waitForTimeout(500);
}

async function pickRange(page, label) {
  const scope = page.locator('[data-testid="seller-dashboard-range-pills"]');
  await scope.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(700);
}

async function scrub(page, name) {
  const chart = page.locator('[data-testid="seller-dashboard-chart"]').first();
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (!box) { console.log('no chart for scrub'); return; }
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + i * 0.03), y);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('ok', name);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

try {
  for (const mode of ['fresh', 'demo']) {
    const extraQuery = mode === 'demo' ? '&demo=1' : '';
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images: {} });
    page.setDefaultNavigationTimeout(240_000);
    page.on('pageerror', (err) => errors.push(`[${mode}] ${err.message}`));
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, server.origin, 'seller', '/(tabs)', { extraQuery });
      try {
        await page.waitForSelector('[data-testid="seller-dashboard-chart"]', { timeout: 30_000 });
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
      }
    }
    await waitForQuietNetwork(activity, 800, 15_000);
    await page.waitForTimeout(1500);
    // Dismiss the setup walkthrough sheet if it opened on its own.
    for (const label of ['Close', 'Not now', 'Skip for now', 'Later']) {
      const btn = page.getByRole('button', { name: label }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(500); }
    }

    await scrollDashboard(page, 0);
    await shot(page, `${mode}-00-top.png`);
    await fitCheck(page, `${mode} top`);
    for (const [i, y] of [[1, 640], [2, 1280], [3, 1920]]) {
      await scrollDashboard(page, y);
      await shot(page, `${mode}-0${i}-scrolled.png`);
      await fitCheck(page, `${mode} scrolled ${y}`);
    }
    await scrollDashboard(page, 0);
    for (const [i, label] of RANGES.entries()) {
      await pickRange(page, label);
      await shot(page, `${mode}-1${i}-range-${label.toLowerCase()}.png`);
      await fitCheck(page, `${mode} range ${label}`);
    }
    await pickRange(page, RANGES[1]);
    await scrub(page, `${mode}-20-scrub.png`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(`page errors:\n  ${errors.slice(0, 20).join('\n  ')}`);
  process.exitCode = 1;
}
