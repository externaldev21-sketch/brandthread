#!/usr/bin/env node
/**
 * Reusable text-fit & alignment check (Playwright, 393x852, web preview).
 *
 * Loads each route in the same demo web build + fake Clerk/API harness that
 * scripts/store-screenshots and scripts/audit use, then flags, per route:
 *
 *   truncated   text whose content is clipped: scrollWidth > clientWidth on an
 *               overflow:hidden / ellipsis element, or a line-clamped block
 *               whose scrollHeight > clientHeight (any visible ellipsis)
 *   overflow    a text box that pokes outside its parent's box (> 1px), when
 *               the parent is not a scroll container
 *   tight-pad   text inside a button/chip/card closer than the minimum
 *               padding to its container edge (12px buttons/chips, 16px cards)
 *   btn-group   sibling buttons in one row with unequal height or width
 *   offscreen   text extending beyond the 393px viewport horizontally
 *
 * Usage:
 *   node scripts/text-fit-check.mjs --routes /buyer-inbox,/help --role buyer
 *        [--data fresh|demo] [--skip-build] [--json out.json] [--shots dir]
 *        [--ci]   exit 1 if anything is found
 *
 * `--routes` defaults to every static route under app/ (no [params]); pass a
 * list when checking the screens a PR touched. Findings are printed and, with
 * --json, written as { route, kind, text, detail }.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const role = val('--role', 'buyer');
const dataState = val('--data', 'fresh');
const shotsDir = val('--shots', null);
const jsonOut = val('--json', null);

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

function staticRoutes() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) {
        walk(p, /^\(.*\)$/.test(n) ? prefix : `${prefix}/${n}`);
      } else if (/\.tsx$/.test(n) && !/\.test\./.test(n) && !n.startsWith('_') && !n.startsWith('+') && !n.includes('[')) {
        const base = n.replace(/\.tsx$/, '');
        out.push(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
      }
    }
  };
  walk(path.join(MOBILE_ROOT, 'app'), '');
  return [...new Set(out)].filter((r) => !r.includes('navigation-isolation-probe')).sort();
}

/** Runs in the page. Returns a list of findings for the visible DOM. */
function inPageCheck() {
  const VW = window.innerWidth;
  const found = [];
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    return r.bottom > 0 && r.top < window.innerHeight * 3; // a few screens down is fine
  };
  const label = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const desc = (el) => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}`;
  const isScroller = (el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY);
  };
  const textRect = (el) => {
    // bounding box of the element's own text nodes
    const range = document.createRange();
    let rect = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1) continue;
      rect = rect
        ? { left: Math.min(rect.left, r.left), right: Math.max(rect.right, r.right), top: Math.min(rect.top, r.top), bottom: Math.max(rect.bottom, r.bottom) }
        : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    return rect;
  };

  const all = [...document.querySelectorAll('body *')].filter(isVisible);
  const seen = new Set();
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const text = label(el);
    const tr = textRect(el);
    const r = el.getBoundingClientRect();

    // truncated text
    const clipsX = /(hidden|clip)/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
    if (clipsX && el.scrollWidth > el.clientWidth + 1 && !isScroller(el)) {
      found.push({ kind: 'truncated', text, detail: `${desc(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
    } else if (/(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) {
      found.push({ kind: 'truncated', text, detail: `${desc(el)} line-clamp ${cs.webkitLineClamp}: scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
    }

    if (!tr) continue;

    // off the viewport horizontally
    if (tr.right > VW + 1 || tr.left < -1) {
      found.push({ kind: 'offscreen', text, detail: `${desc(el)} text box ${Math.round(tr.left)}..${Math.round(tr.right)} vs viewport ${VW}` });
    }

    // overflowing the parent box
    let parent = el.parentElement;
    while (parent && parent !== document.body && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
    if (parent && parent !== document.body && !isScroller(parent)) {
      const p = parent.getBoundingClientRect();
      const over = Math.max(p.left - tr.left, tr.right - p.right, p.top - tr.top, tr.bottom - p.bottom);
      const pcs = getComputedStyle(parent);
      if (over > 1 && pcs.position !== 'absolute' && p.width > 0) {
        found.push({ kind: 'overflow', text, detail: `${desc(el)} exceeds ${desc(parent)} by ${Math.round(over)}px` });
      }
    }

    // minimum padding in buttons / chips / cards
    const box = el.closest('button, [role="button"], [role="tab"], a[href]');
    if (box && isVisible(box)) {
      const b = box.getBoundingClientRect();
      const min = b.height <= 64 ? 12 : 16;
      const left = tr.left - b.left;
      const right = b.right - tr.right;
      // a full-width row/list item is not a chip: only judge boxes narrower than the screen gutter
      if (b.width < VW - 32 && (left < min - 0.5 || right < min - 0.5) && !seen.has(box)) {
        seen.add(box);
        found.push({ kind: 'tight-pad', text, detail: `${desc(box)} ${Math.round(b.width)}x${Math.round(b.height)}; text ${Math.round(left)}px left / ${Math.round(right)}px right (min ${min})` });
      }
    }
  }

  // sibling buttons in a row: equal width + height
  const rows = new Set();
  for (const b of document.querySelectorAll('button, [role="button"]')) {
    if (!isVisible(b) || !b.parentElement) continue;
    rows.add(b.parentElement);
  }
  for (const row of rows) {
    const kids = [...row.children].filter((c) => isVisible(c) && (c.matches('button, [role="button"]') || c.querySelector('button, [role="button"]')));
    if (kids.length < 2 || kids.length > 4) continue;
    const cs = getComputedStyle(row);
    if (!/row/.test(cs.flexDirection) || cs.display !== 'flex') continue;
    const rects = kids.map((k) => k.getBoundingClientRect());
    const hs = rects.map((r) => Math.round(r.height));
    const ws = rects.map((r) => Math.round(r.width));
    const hDiff = Math.max(...hs) - Math.min(...hs);
    const wDiff = Math.max(...ws) - Math.min(...ws);
    // flex:1 groups must be equal; fixed pills may differ in width but not height
    const flexEq = kids.every((k) => getComputedStyle(k).flexGrow === '1');
    if (hDiff > 2 || (flexEq && wDiff > 2)) {
      found.push({ kind: 'btn-group', text: kids.map(label).join(' | '), detail: `heights ${hs.join('/')} widths ${ws.join('/')}` });
    }
  }
  return found;
}

async function main() {
  const routes = val('--routes', null)?.split(',').filter(Boolean) ?? staticRoutes();
  if (!flag('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const results = [];
  try {
    for (const route of routes) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role, origin, images });
      try {
        const target = `${route}${dataState === 'demo' ? (route.includes('?') ? '&' : '?') + 'demo=1' : ''}`;
        await openScreen(page, activity, origin, role, target);
        await page.waitForTimeout(1200);
        await waitForQuietNetwork(activity, 600, 8000);
        await waitForImages(page, 6000);
        const found = await page.evaluate(inPageCheck);
        const seenKeys = new Set();
        for (const f of found) {
          const key = `${f.kind}|${f.text}|${f.detail}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          results.push({ route, ...f });
        }
        if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${route.replace(/\W+/g, '_') || 'root'}.png`) });
        console.log(`${found.length ? 'FLAG' : 'ok  '} ${route}${found.length ? `  (${seenKeys.size})` : ''}`);
      } catch (e) {
        console.log(`ERR  ${route}  ${String(e.message).split('\n')[0]}`);
        results.push({ route, kind: 'error', text: '', detail: String(e.message).split('\n')[0] });
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    close();
  }
  for (const r of results) console.log(`${r.route}  [${r.kind}]  "${r.text}"  ${r.detail}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`\n${results.length} finding(s) across ${routes.length} route(s)`);
  if (flag('--ci') && results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
