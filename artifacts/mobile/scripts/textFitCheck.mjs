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
export async function checkTextFit(page, options = {}) {
  const minPad = typeof options === 'number' ? options : typeof options === 'object' ? options.minPad ?? 12 : 12;
  const label = typeof options === 'string' ? options : typeof options === 'object' ? options.label : undefined;
  const problems = await page.evaluate((minPadding) => {
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
  return label ? problems.map((problem) => ({ ...problem, label })) : problems;
}

export async function assertTextFit(page, label, options = {}) {
  const issues = await checkTextFit(page, { ...options, label });
  if (issues.length) throw new Error(`Text-fit check failed on ${label}: ${issues.length} issue(s)`);
  return issues;
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
/**
 * Text-fit & alignment check for Playwright pages (Expo web preview).
 *
 * Flags, for every visible text-bearing element:
 *   - "clipped": the element's own text is wider/taller than its box
 *     (scrollWidth > clientWidth or scrollHeight > clientHeight), which is how
 *     an ellipsis / line-clamp / hard clip shows up in the DOM;
 *   - "outside-parent": a text element's box pokes out of its parent's box;
 *   - "off-screen": text that runs past the left/right viewport edge (unless it
 *     sits inside a horizontally scrolling container, e.g. a chip rail, where
 *     running off the edge is the intended scroll affordance);
 *   - "tight-padding": text inside a button/chip/card-like box (has a
 *     background or border) closer than `minPadX` px to that box's left/right edge.
 *
 * Usage:
 *   import { checkTextFitDetailed, formatTextFitReport } from './textFitCheck.mjs';
 *   const issues = await checkTextFitDetailed(page, { label: 'discover', minPadX: 12 });
 *   console.log(formatTextFitReport('discover', issues));
 *
 * CLI (against an already-served origin):
 *   node scripts/textFitCheck.mjs <url> [minPadX]
 */

/** Runs in the page. Kept dependency-free so it can be passed to page.evaluate. */
function collectDetailedIssues({ minPadX, ignoreSelector }) {
  const issues = [];
  const vw = window.innerWidth;

  const isVisible = (el, rect, cs) =>
    rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;

  const inHorizontalScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  // Icon-font glyphs live in the private-use area; they are not text to fit.
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/[\uE000-\uF8FF]/g, '').trim();
  const hasOwnText = (el) => ownText(el).length > 0;

  const describe = (el) => {
    const text = (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
    const id = el.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${text}"`;
  };

  const boxedAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
      if (hasBg || hasBorder) return p;
      const r = p.getBoundingClientRect();
      if (r.width > vw * 0.9) return null;
    }
    return null;
  };

  for (const el of document.body.querySelectorAll('*')) {
    if (ignoreSelector && el.closest(ignoreSelector)) continue;
    if (!hasOwnText(el)) continue;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!isVisible(el, rect, cs)) continue;
    const scroller = inHorizontalScroller(el);

    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      issues.push({ kind: 'clipped', detail: `${describe(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
    } else if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0 && cs.overflow !== 'visible') {
      issues.push({ kind: 'clipped', detail: `${describe(el)} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
    }

    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const pr = parent.getBoundingClientRect();
      const pcs = getComputedStyle(parent);
      const parentClips = pcs.overflow !== 'visible';
      if (!scroller && pr.width > 0 && (rect.left < pr.left - 1 || rect.right > pr.right + 1) && !parentClips) {
        issues.push({ kind: 'outside-parent', detail: `${describe(el)} [${Math.round(rect.left)}..${Math.round(rect.right)}] vs parent [${Math.round(pr.left)}..${Math.round(pr.right)}]` });
      }
    }

    if (!scroller && (rect.left < -1 || rect.right > vw + 1)) {
      issues.push({ kind: 'off-screen', detail: `${describe(el)} [${Math.round(rect.left)}..${Math.round(rect.right)}] viewport ${vw}` });
    }

    const box = boxedAncestor(el);
    // Only judge padding when this text is the box's own label (a button /
    // chip / pill / badge), not one line among many inside a big card.
    const boxText = box ? (box.innerText ?? '').replace(/[\uE000-\uF8FF]/g, '').trim().replace(/\s+/g, ' ') : '';
    if (box && boxText === ownText(el).replace(/\s+/g, ' ')) {
      const br = box.getBoundingClientRect();
      // Range of the real text, not the (possibly stretched) element box.
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const left = tr.left - br.left;
      const right = br.right - tr.right;
      if (br.width < vw * 0.9 && (left < minPadX - 0.5 || right < minPadX - 0.5) && br.width > tr.width + 1) {
        issues.push({ kind: 'tight-padding', detail: `${describe(el)} padL ${Math.round(left)} padR ${Math.round(right)} (< ${minPadX})` });
      }
    }
  }
  return issues;
}

export async function checkTextFitDetailed(page, { minPadX = 12, ignoreSelector = null } = {}) {
  return page.evaluate(collectDetailedIssues, { minPadX, ignoreSelector });
}

export function formatTextFitReport(label, issues) {
  if (issues.length === 0) return `text-fit ${label}: OK (0 issues)`;
  return [`text-fit ${label}: ${issues.length} issue(s)`, ...issues.map((i) => `  - ${i.kind}: ${i.detail}`)].join('\n');
}
/**
 * Shared text-fit & alignment check for Playwright screenshots.
 *
 *   import { textFitCheckScoped } from './textFitCheck.mjs';
 *   const problems = await textFitCheck(page, { label: 'category' });
 *
 * Flags, for every visible element that directly owns text:
 *   - clipped: scrollWidth > clientWidth (single-line ellipsis / cut-off) or
 *     scrollHeight > clientHeight on a multi-line clamp;
 *   - overflow-parent: the text box extends past its parent's box;
 *   - off-screen: the text box extends past the viewport's left/right edge;
 *   - edge-touch: the text box sits within `edgePad` px of a viewport edge.
 * Returns an array of { kind, text, rect } (empty = clean).
 */
export async function textFitCheck(page, { label = '', edgePad = 8, ignore = [] } = {}) {
  const problems = await page.evaluate(({ edgePad: pad, ignore: ignoreList }) => {
    const out = [];
    const vw = window.innerWidth;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (ignoreList.some((needle) => text.includes(needle))) continue;
      const short = text.slice(0, 60);
      const r = { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
      if (el.scrollWidth > el.clientWidth + 1) out.push({ kind: 'clipped-width', text: short, rect: r });
      else if (el.scrollHeight > el.clientHeight + 2 && style.overflow !== 'visible') out.push({ kind: 'clipped-height', text: short, rect: r });
      const parent = el.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        const scrollsHorizontally = ps.overflowX === 'auto' || ps.overflowX === 'scroll';
        if (!scrollsHorizontally && pr.width > 0 && (rect.right > pr.right + 1 || rect.left < pr.left - 1)) {
          out.push({ kind: 'overflow-parent', text: short, rect: r });
        }
      }
      let scrollable = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') { scrollable = true; break; }
      }
      if (!scrollable) {
        if (rect.right > vw + 1 || rect.left < -1) out.push({ kind: 'off-screen', text: short, rect: r });
        else if (rect.right > vw - pad || rect.left < pad) out.push({ kind: 'edge-touch', text: short, rect: r });
      }
    }
    return out;
  }, { edgePad, ignore });
  return problems.map((p) => ({ ...p, label }));
}
/**
 * Text-fit & alignment check (Dev's rule): flags visible text that does not
 * fit its box on the page currently open in Playwright.
 *
 *   import { textFitCheck } from './textFitCheck.mjs';
 *   const offenders = await textFitCheckScoped(page, { scope: '[data-testid="search-filter-sheet"]' });
 *
 * Flags, for every element that directly holds text:
 *  - truncated:  scrollWidth > clientWidth (clipped / ellipsised)
 *  - ellipsis:   text-overflow: ellipsis is actually truncating
 *  - overflow:   the text box sticks out of its parent's box by > 1px
 *  - offscreen:  the text box crosses the viewport's left/right edge
 * Returns an array of { text, reason, rect }; empty means clean.
 */
export async function textFitCheckScoped(page, { scope = 'body', tolerance = 1 } = {}) {
  return page.evaluate(({ scope, tolerance }) => {
    const root = document.querySelector(scope) ?? document.body;
    const vw = window.innerWidth;
    const out = [];
    const visible = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasOwnText || !visible(el)) continue;
      const text = el.textContent.trim().slice(0, 60);
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const box = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      if (el.scrollWidth > el.clientWidth + tolerance && cs.overflowX !== 'visible') out.push({ text, reason: 'truncated', rect: box });
      else if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + tolerance) out.push({ text, reason: 'ellipsis', rect: box });
      const parent = el.parentElement;
      if (parent && parent !== document.body) {
        const pr = parent.getBoundingClientRect();
        if (pr.width > 0 && (rect.left < pr.left - tolerance || rect.right > pr.right + tolerance)) out.push({ text, reason: 'overflow', rect: box });
      }
      if (rect.left < -tolerance || rect.right > vw + tolerance) out.push({ text, reason: 'offscreen', rect: box });
    }
    return out;
  }, { scope, tolerance });
}

/** Scoped text clipping and parent/viewport overflow check for screenshot audits. */
export async function collectTextFitIssues(page, { root = 'body', tolerance = 1 } = {}) {
  return page.evaluate(({ root, tolerance }) => {
    const scope = document.querySelector(root) ?? document.body;
    const vw = window.innerWidth;
    const issues = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let inScroller = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if ((o === 'scroll' || o === 'auto') && a.scrollWidth > a.clientWidth + 1) { inScroller = true; break; }
      }
      if (inScroller) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const text = el.textContent.trim().slice(0, 40);
      const clipped = el.scrollWidth > el.clientWidth + tolerance && cs.overflowX !== 'visible';
      const ellipsed = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + tolerance;
      const p = el.parentElement?.getBoundingClientRect();
      const overParent = !!p && p.width > 0 && (r.left < p.left - tolerance || r.right > p.right + tolerance);
      const offScreen = r.left < -tolerance || r.right > vw + tolerance;
      if (clipped || ellipsed || overParent || offScreen) {
        issues.push({ text, clipped, ellipsed, overParent, offScreen, left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return issues;
  }, { root, tolerance });
}

export async function textFitIssues(page, rootSelector) {
  return collectTextFitIssues(page, { root: rootSelector ?? 'body' });
}

export async function assertTextFits(page, name = 'screen', rootSelector) {
  const issues = await textFitIssues(page, rootSelector);
  if (issues.length === 0) console.log(`  text-fit OK: ${name}`);
  else console.log(`  text-fit ISSUES on ${name}:`, JSON.stringify(issues));
  return issues;
}
