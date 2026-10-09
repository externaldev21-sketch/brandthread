#!/usr/bin/env node
/**
 * Thread Cash wallet entry row + Ledger screen at 393x852 (demo preview).
 *   node scripts/thread-cash-ledger-screenshots.mjs <outDir>
 * Builds the preview web app, serves it, and screenshots with &demo=1.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, DEFAULT_BUILD_DIR, buildPreviewWeb, serveBuild, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/thread-cash-ledger'));
mkdirSync(OUT, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true };

async function session(demo) {
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, server.origin, 'buyer', `/thread-cash${demo ? '?demo=1' : ''}`);
  await waitForQuietNetwork(activity, 900, 20_000);
  await page.waitForTimeout(1500);
  return { context, page };
}
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, name) }); console.log('ok', name); };

/** Text-fit check: truncated/clipped text, text wider than its box, boxes spilling out of their parent, header divider. */
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
    const header = document.querySelector('[data-testid="screen-header"]');
    if (header && parseFloat(getComputedStyle(header).borderBottomWidth) > 0) out.push('header has a divider');
    return out;
  });
  console.log(problems.length ? `FIT FAIL ${label}:\n  ${problems.join('\n  ')}` : `fit ok ${label}`);
  if (problems.length) process.exitCode = 1;
}
const zoom = async (page, testIdOrSel, name) => {
  const box = await page.locator(testIdOrSel).first().boundingBox();
  if (!box) return;
  await page.screenshot({ path: path.join(OUT, name), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(393, box.width + 16), height: box.height + 16 } });
  console.log('ok', name);
};

try {
  const { context, page } = await session(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  const row = page.getByTestId('thread-cash-open-ledger');
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(300);
  await shot(page, '00-wallet-top.png');
  await fitCheck(page, 'wallet top');
  await zoom(page, 'text=Your balance >> xpath=../..', '10-zoom-balance-card.png');
  await zoom(page, 'text=Day >> xpath=../../..', '11-zoom-streak-card.png');
  await row.scrollIntoViewIfNeeded();
  await shot(page, '01-wallet-ledger-row.png');
  await fitCheck(page, 'wallet bottom');
  await row.click();
  await page.getByTestId('thread-cash-ledger-balance').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, '02-ledger-all.png');
  await fitCheck(page, 'ledger all');
  await zoom(page, 'role=button[name="All"] >> xpath=..', '12-zoom-filter-pills.png');
  await page.getByRole('button', { name: 'Spent' }).click();
  await page.waitForTimeout(800);
  await shot(page, '03-ledger-spent.png');
  await page.getByRole('button', { name: 'Expired' }).click();
  await page.waitForTimeout(800);
  await shot(page, '04-ledger-expired.png');
  await context.close();

  // Fresh account (no demo): real empty state, no invented data.
  const fresh = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
  fresh.page.setDefaultNavigationTimeout(240_000);
  await openScreen(fresh.page, fresh.activity, server.origin, 'buyer', '/thread-cash');
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await fresh.page.getByTestId('thread-cash-open-ledger').click({ timeout: 20_000 }); break; } catch (e) {
      if (attempt === 3) throw e;
      await openScreen(fresh.page, fresh.activity, server.origin, 'buyer', '/thread-cash');
    }
  }
  await fresh.page.getByTestId('thread-cash-ledger-balance').waitFor({ timeout: 30_000 });
  await fresh.page.waitForTimeout(800);
  await shot(fresh.page, '05-ledger-empty.png');
  await fitCheck(fresh.page, 'ledger empty');
} finally {
  await browser.close();
  server.close();
}
