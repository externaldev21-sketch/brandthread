#!/usr/bin/env node
/**
 * Text-fit & alignment checks shared by UI audits.
 *
 * Import the Playwright helper with:
 *   import { checkTextFit } from './textFitCheck.mjs';
 *   const problems = await checkTextFit(page);
 *
 * Audit multiple preview routes with:
 *   node scripts/textFitCheck.mjs /buyer-my-sizes /buyer-settings [--skip-build] [--shots=<dir>]
 *
 * Or audit an already-running page URL with:
 *   node scripts/textFitCheck.mjs http://localhost:8081/buyer-my-sizes
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Checks every element that directly holds text for clipping, ellipsis,
 * parent/viewport overflow, and insufficient padding inside a bordered or
 * filled container. React Native Web renders <Text> elements as divs.
 */
export async function checkTextFit(page, { minPad = 12 } = {}) {
  return page.evaluate((minPadding) => {
    const problems = [];
    const vw = document.documentElement.clientWidth;
    const hasBox = (cs) =>
      parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 ||
      (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
    const label = (el) => `${el.tagName.toLowerCase()}[${(el.textContent || '').trim().slice(0, 40)}]`;

    for (const el of document.querySelectorAll('body *')) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') {
        problems.push({ kind: 'clipped-x', el: label(el) });
      }
      if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible' && cs.overflowY !== 'auto') {
        problems.push({ kind: 'clipped-y', el: label(el) });
      }
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        problems.push({ kind: 'ellipsis', el: label(el) });
      }
      if (r.left < -1 || r.right > vw + 1) problems.push({ kind: 'off-screen', el: label(el) });

      const parent = el.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) problems.push({ kind: 'overflows-parent', el: label(el) });
        let box = parent;
        while (box && box !== document.body && !hasBox(getComputedStyle(box))) box = box.parentElement;
        if (box && box !== document.body) {
          const br = box.getBoundingClientRect();
          const left = r.left - br.left;
          const right = br.right - r.right;
          const centredBadge = br.width <= 48 && Math.abs(left - right) <= 2;
          if (!centredBadge && Math.min(left, right) < minPadding - 0.5) {
            problems.push({ kind: 'tight-padding', el: label(el), left: Math.round(left), right: Math.round(right) });
          }
        }
      }
    }
    return problems;
  }, minPad);
}

/** Legacy shared-preview scan retained for multi-route screenshot audits. */
function inPage() {
  const issues = [];
  const vw = window.innerWidth;
  const hasText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const boxed = (el) => {
    const cs = getComputedStyle(el);
    const border = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    const bg = cs.backgroundColor;
    return border || (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!hasText(el) || !isVisible(el)) continue;
    const label = `"${el.textContent.trim().slice(0, 40)}"`;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') {
      issues.push(`clipped text ${label} (${el.scrollWidth}>${el.clientWidth})`);
    }
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push(`ellipsis ${label}`);
    const r = el.getBoundingClientRect();
    let scroller = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const overflow = getComputedStyle(p).overflowX;
      if ((overflow === 'auto' || overflow === 'scroll') && p.scrollWidth > p.clientWidth) {
        scroller = true;
        break;
      }
    }
    if (!scroller && (r.left < -1 || r.right > vw + 1)) {
      issues.push(`off-screen text ${label} (${Math.round(r.left)}..${Math.round(r.right)})`);
    }
    const box = (() => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (boxed(p)) return p;
      return null;
    })();
    if (box) {
      const b = box.getBoundingClientRect();
      if (r.left < b.left - 0.5 || r.right > b.right + 0.5) issues.push(`text ${label} overflows its box horizontally`);
      const padL = r.left - b.left;
      const padR = b.right - r.right;
      if (b.width < vw - 8 && (padL < 10 || padR < 10) && r.width > 0) {
        issues.push(`text ${label} too close to box edge (L${Math.round(padL)} R${Math.round(padR)})`);
      }
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) {
    issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth}>${vw})`);
  }
  return issues;
}

async function auditRoutes(args) {
  const { buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, DEFAULT_BUILD_DIR } =
    await import('./store-screenshots/harness.mjs');
  const routes = args.filter((arg) => arg.startsWith('/'));
  const skipBuild = args.includes('--skip-build');
  const shotsArg = args.find((arg) => arg.startsWith('--shots='));
  const shotsDir = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : null;
  if (routes.length === 0) {
    console.error('Pass at least one route, e.g. /buyer-my-sizes');
    process.exit(2);
  }

  if (!skipBuild) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  let failed = 0;
  try {
    const device = {
      viewport: { width: 393, height: 852 },
      scale: 2,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    };
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
      issues.forEach((message) => console.log(`   - ${message}`));
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

async function auditUrl(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
    await page.goto(url);
    await page.waitForTimeout(5000);
    const problems = await checkTextFit(page);
    console.log(problems.length ? JSON.stringify(problems, null, 2) : 'text-fit: clean');
    process.exitCode = problems.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const firstUrl = args.find((arg) => /^https?:\/\//.test(arg));
  const run = firstUrl ? auditUrl(firstUrl) : auditRoutes(args);
  run.catch((error) => {
    console.error(error);
    process.exit(2);
  });
}