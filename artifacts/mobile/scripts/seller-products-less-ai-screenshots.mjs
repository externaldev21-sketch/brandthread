#!/usr/bin/env node
/**
 * Seller Products (items 79–84) at 390x844 @2x, demo and fresh seller preview:
 * products list, grid, add button above the tab bar, product editor top
 * (photo grid), grouped sections and the variant table.
 *
 *   node scripts/seller-products-less-ai-screenshots.mjs <outDir> [mobileRoot] [buildDir]
 *
 * `mobileRoot` lets the same script shoot a BEFORE checkout (e.g. a
 * `git worktree add` of origin/dev). SKIP_BUILD=1 reuses an existing build.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, DEFAULT_BUILD_DIR, buildPreviewWeb, serveBuild, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/seller-products/after'));
const ROOT = path.resolve(process.argv[3] ?? MOBILE_ROOT);
const BUILD = path.resolve(process.argv[4] ?? DEFAULT_BUILD_DIR);
mkdirSync(OUT, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb(BUILD, ROOT);
const server = await serveBuild(BUILD);
const browser = await launchBrowser();
const W = 390; const H = 844;
const device = { viewport: { width: W, height: H }, scale: 2, isMobile: true };

const shot = async (page, name, clip) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, name), ...(clip ? { clip } : {}) });
  console.log('ok', name);
};

/** Text-fit check: clipped text, ellipsis, text wider than its parent or the screen. */
async function fitCheck(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    const scroller = (el) => { for (let p = el; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const name = `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 40)}`;
      if (el.scrollWidth > el.clientWidth + 1 && !scroller(el)) out.push(`text clipped ${name} (${el.scrollWidth}>${el.clientWidth})`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis ${name}`);
      const p = el.parentElement;
      if (p && !scroller(el)) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1)) out.push(`overflows parent ${name}`);
      }
      // Far off-canvas (< -1000) is a deliberately parked node, e.g. a swipe row's hidden actions.
      if (!scroller(el) && r.left > -1000 && (r.right > vw + 1 || r.left < -1)) out.push(`off screen ${name} ${JSON.stringify((el.textContent || '').slice(0, 12))} [${Math.round(r.left)}..${Math.round(r.right)}, y${Math.round(r.top)}]`);
    }
    return out;
  });
  console.log(problems.length ? `FIT FAIL ${label}:\n  ${problems.join('\n  ')}` : `fit ok ${label}`);
  if (problems.length) process.exitCode = 1;
}

/** The add button must sit fully above the tab bar's top edge. */
async function fabCheck(page, label) {
  const result = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('[aria-label="Add product"], [data-testid="products-add-fab"]')];
    const all = roots.flatMap((el) => [el, ...el.querySelectorAll('*')]).map((el) => el.getBoundingClientRect());
    const fabs = all.filter((r) => r.width >= 40 && r.width <= 80 && r.height >= 40 && r.height <= 80);
    if (fabs.length === 0) return `no add button (${all.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}`).join(', ')})`;
    const f = fabs[fabs.length - 1];
    const bars = [...document.querySelectorAll('[role="tablist"], [data-testid*="tab-bar"], [data-testid*="tabbar"]')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0 && r.top > window.innerHeight / 2);
    if (bars.length === 0) return `fab bottom ${Math.round(f.bottom)} (no tab bar found)`;
    const top = Math.min(...bars.map((r) => r.top));
    return f.bottom <= top ? `ok: fab bottom ${Math.round(f.bottom)} <= bar top ${Math.round(top)}` : `FAIL: fab bottom ${Math.round(f.bottom)} > bar top ${Math.round(top)}`;
  });
  console.log(`fab ${label}: ${result}`);
  if (result.startsWith('FAIL')) process.exitCode = 1;
}

async function open(demo, target) {
  const ctx = await openContext(browser, { device, role: 'seller', origin: server.origin, images: {} });
  ctx.page.setDefaultNavigationTimeout(240_000);
  await openScreen(ctx.page, ctx.activity, server.origin, 'seller', target, {
    extraQuery: demo ? '&demo=1' : '',
    // Let the seller root finish its own redirect to Dashboard first, or it
    // lands on top of the screen we push.
    beforeNavigate: async () => {
      await ctx.page.locator('[data-testid="seller-tab-products"]').first().waitFor({ timeout: 60_000 });
      await ctx.page.waitForTimeout(2000);
    },
  });
  await waitForQuietNetwork(ctx.activity, 900, 20_000);
  await ctx.page.waitForTimeout(2500);
  return ctx;
}

async function wheel(page, dy) {
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(700);
}

try {
  for (const demo of [true, false]) {
    const tag = demo ? 'demo' : 'fresh';

    // Products list (default view) + add button.
    const list = await open(demo, '/products');
    // Demo flags are read from the URL at render time; flip a status chip
    // and back so the list re-queries with them applied.
    await list.page.getByRole('button', { name: /^Active/ }).first().click();
    await list.page.waitForTimeout(800);
    await list.page.getByRole('button', { name: /^All/ }).first().click();
    await list.page.waitForTimeout(1500);
    await shot(list.page, `01-products-list-${tag}.png`);
    await fitCheck(list.page, `products list ${tag}`);
    await fabCheck(list.page, tag);
    await shot(list.page, `03-products-fab-${tag}.png`, { x: 0, y: H - 260, width: W, height: 260 });

    // Grid view (only where the toggle exists).
    const toggle = list.page.getByRole('button', { name: 'Show as grid' });
    if (await toggle.count()) {
      await toggle.first().click();
      await list.page.waitForTimeout(800);
      await shot(list.page, `02-products-grid-${tag}.png`);
      await fitCheck(list.page, `products grid ${tag}`);
      // Back to list so the next run starts from the default.
      await list.page.getByRole('button', { name: 'Show as list' }).first().click();
    }
    await list.context.close();

    // Product editor: demo edits a seeded product (3 photos, 3 variants); fresh is a blank add.
    const editor = await open(demo, demo ? '/add-product?editId=preview-product-1' : '/add-product');
    await shot(editor.page, `04-editor-top-${tag}.png`);
    await fitCheck(editor.page, `editor top ${tag}`);
    await wheel(editor.page, 640);
    await shot(editor.page, `05-editor-sections-${tag}.png`);
    await fitCheck(editor.page, `editor sections ${tag}`);
    await wheel(editor.page, 640);
    await shot(editor.page, `06-editor-variants-${tag}.png`);
    await fitCheck(editor.page, `editor variants ${tag}`);
    await wheel(editor.page, 900);
    await shot(editor.page, `07-editor-more-${tag}.png`);
    await fitCheck(editor.page, `editor more ${tag}`);
    await editor.context.close();
  }
} finally {
  await browser.close();
  server.close();
}
