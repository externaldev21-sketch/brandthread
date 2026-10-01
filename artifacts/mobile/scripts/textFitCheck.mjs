#!/usr/bin/env node
/**
 * Text-fit & alignment check (shared). Opens routes at 393x852 in the preview
 * web build and flags:
 *   - text elements whose scrollWidth > clientWidth (clipped / ellipsised)
 *   - text whose box overflows the viewport or its nearest bordered/filled ancestor
 *   - screens with a horizontal page scroll
 *
 *   node scripts/textFitCheck.mjs /buyer-my-sizes /buyer-settings [--skip-build] [--shots=<dir>]
 *
 * Exit code 1 when any issue is found. Optional --shots saves a full-page
 * screenshot per route plus zoomed element shots of [data-testid] groups.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const args = process.argv.slice(2);
const routes = args.filter((a) => a.startsWith('/'));
const skipBuild = args.includes('--skip-build');
const shotsArg = args.find((a) => a.startsWith('--shots='));
const shotsDir = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : null;
if (routes.length === 0) { console.error('Pass at least one route, e.g. /buyer-my-sizes'); process.exit(2); }

/** Runs in the page. Returns an array of issue strings. */
function inPage() {
  const issues = [];
  const vw = window.innerWidth;
  const hasText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const boxed = (el) => { const cs = getComputedStyle(el); const b = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0; const bg = cs.backgroundColor; return b || (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'); };
  for (const el of document.querySelectorAll('body *')) {
    if (!hasText(el) || !isVisible(el)) continue;
    const label = `"${el.textContent.trim().slice(0, 40)}"`;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') issues.push(`clipped text ${label} (${el.scrollWidth}>${el.clientWidth})`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push(`ellipsis ${label}`);
    const r = el.getBoundingClientRect();
    // Only flag viewport overflow for elements not inside a horizontal scroller.
    let scroller = false;
    for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) { scroller = true; break; } }
    if (!scroller && (r.left < -1 || r.right > vw + 1)) issues.push(`off-screen text ${label} (${Math.round(r.left)}..${Math.round(r.right)})`);
    const box = (() => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (boxed(p)) return p; return null; })();
    if (box) {
      const b = box.getBoundingClientRect();
      if (r.left < b.left - 0.5 || r.right > b.right + 0.5) issues.push(`text ${label} overflows its box horizontally`);
      const padL = r.left - b.left; const padR = b.right - r.right;
      if (box.getBoundingClientRect().width < vw - 8 && (padL < 10 || padR < 10) && r.width > 0) issues.push(`text ${label} too close to box edge (L${Math.round(padL)} R${Math.round(padR)})`);
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth}>${vw})`);
  return issues;
}

async function main() {
  if (!skipBuild) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  let failed = 0;
  try {
    const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
    for (const route of routes) {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
      for (let i = 0; i < 5; i += 1) {
        await openScreen(page, activity, origin, 'buyer', route);
        await page.waitForTimeout(800);
        if (await page.evaluate(() => window.location.pathname) === route.split('?')[0]) break;
      }
      await page.waitForTimeout(1200);
      const issues = await page.evaluate(inPage);
      console.log(`${issues.length ? 'FAIL' : 'PASS'} ${route}`);
      issues.forEach((m) => console.log(`   - ${m}`));
      if (issues.length) failed += 1;
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        await page.screenshot({ path: path.join(shotsDir, `${name}.png`), animations: 'disabled' });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(failed ? `\n${failed} route(s) with text-fit issues` : '\nText-fit check passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
