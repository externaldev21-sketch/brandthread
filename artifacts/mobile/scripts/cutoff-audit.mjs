#!/usr/bin/env node
/**
 * Cutoff audit (Playwright, web preview). Loads every route at several phone
 * sizes in the same demo web build + fake Clerk/API harness that
 * scripts/text-fit-check.mjs and scripts/store-screenshots use, and flags
 * anything that would read as cut off:
 *
 *   truncated   text clipped by its own box (scrollWidth > clientWidth on an
 *               overflow:hidden element, or a line-clamped block that
 *               overflows), with or without a visible ellipsis
 *   midword     a single-line clipped label on a button/chip (never OK)
 *   offscreen   text extending past the left/right edge of the viewport
 *   overflow    text poking outside its (non-scrolling) parent box
 *   covered     after scrolling every scroller to its end, text whose centre
 *               sits under another element (tab bar, pinned footer, sheet)
 *   pagewidth   the document itself scrolls horizontally
 *
 * Sizes: 390x844 (iPhone 15), 375x667 (iPhone SE), 430x932 (Pro Max). With
 * --dynamic-type, every size is run a second time with all text scaled to
 * the largest standard Dynamic Type size (xxxLarge, ~1.35x body). The web
 * build drops maxFontSizeMultiplier, so this is a worst case: findings on
 * text the app already caps (buttons, chips, headers) are triaged by hand.
 *
 * Usage:
 *   node scripts/cutoff-audit.mjs [--routes /a,/b] [--role buyer|seller]
 *        [--sizes se,iphone,promax] [--dynamic-type] [--stress]
 *        [--skip-build] [--json out.json] [--shots dir] [--concurrency 4]
 *
 * --stress lengthens product/brand/user names and inflates counts in the
 * fake API's responses, so long names and big numbers are exercised.
 *
 * Sheets and modals: a route may carry taps after " >> " — e.g.
 *   "/buyer-product-detail?productId=prod_nl_hoodie_ember >> Select options"
 * opens the screen, taps the element whose text or accessibility label is
 * "Select options", and audits what is on screen after the last tap.
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
import { respond } from './store-screenshots/demo-data.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const role = val('--role', 'buyer');
const shotsDir = val('--shots', null);
const jsonOut = val('--json', null);
const concurrency = Number(val('--concurrency', 4));
const stress = flag('--stress');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SIZES = {
  iphone: { width: 390, height: 844 },
  se: { width: 375, height: 667 },
  promax: { width: 430, height: 932 },
};
const sizeIds = val('--sizes', 'iphone,se,promax').split(',').filter((s) => SIZES[s]);
const DYNAMIC_TYPE_SCALE = 1.35;

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

/** Lengthens names and inflates counts in a fake-API JSON body. */
function stressBody(body) {
  const NAME_KEYS = /^(name|title|displayName|brandName|storeName|sellerName|productName|username|handle|fullName)$/;
  const COUNT_KEYS = /(count|Count|followers|following|likes|views|claimed|total|Total)$/;
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    if (typeof v === 'string' && key && NAME_KEYS.test(key) && v.length < 40) {
      return /handle|username/.test(key) ? `${v}_officialstudio` : `${v} Extended Limited Edition`;
    }
    if (typeof v === 'number' && key && COUNT_KEYS.test(key) && Number.isInteger(v) && v > 0 && v < 1e6) return v * 1371 + 9;
    return v;
  };
  return walk(body);
}

/** Runs in the page: optional Dynamic Type emulation. */
function applyDynamicType(scale) {
  const apply = () => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.dataset.btDt) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      if (!fs) continue;
      el.dataset.btDt = '1';
      el.style.fontSize = `${fs * scale}px`;
      const lh = parseFloat(cs.lineHeight);
      if (lh) el.style.lineHeight = `${lh * scale}px`;
    }
  };
  apply();
}

/** Runs in the page. Returns findings for the visible DOM. */
function inPageCheck(phase) {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const found = [];
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    let p = el.parentElement;
    while (p) {
      const pcs = getComputedStyle(p);
      if (Number(pcs.opacity) === 0 || pcs.visibility === 'hidden') return false;
      p = p.parentElement;
    }
    return r.bottom > 0 && r.top < VH;
  };
  const label = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const desc = (el) => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}`;
  const isScroller = (el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY);
  };
  const inHorizontalScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const textRect = (el) => {
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

  if (phase === 'top' && document.scrollingElement.scrollWidth > VW + 1) {
    found.push({ kind: 'pagewidth', text: '', detail: `document scrollWidth ${document.scrollingElement.scrollWidth} > ${VW}` });
  }

  for (const el of document.querySelectorAll('body *')) {
    if (!isVisible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const text = label(el);
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue; // icon glyphs
    const cs = getComputedStyle(el);
    const tr = textRect(el);

    if (phase === 'top') {
      const clipsX = /(hidden|clip)/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
      const onControl = el.closest('button, [role="button"], [role="tab"], a[href]');
      const clipped = clipsX && el.scrollWidth > el.clientWidth + 1 && !isScroller(el);
      if (clipped) {
        const single = cs.whiteSpace === 'nowrap' || cs.webkitLineClamp === '1';
        found.push({ kind: onControl && single && el.clientWidth < 220 ? 'midword' : 'truncated', text, detail: `${desc(el)} ${el.scrollWidth}>${el.clientWidth}px` });
      } else if (/(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && cs.webkitLineClamp && cs.webkitLineClamp !== 'none') {
        found.push({ kind: 'truncated', text, detail: `${desc(el)} clamp ${cs.webkitLineClamp}: ${el.scrollHeight}>${el.clientHeight}px` });
      }
      if (tr && !clipped && !inHorizontalScroller(el) && (tr.right > VW + 1 || tr.left < -1)) {
        found.push({ kind: 'offscreen', text, detail: `${desc(el)} ${Math.round(tr.left)}..${Math.round(tr.right)} vs ${VW}` });
      }
      let parent = el.parentElement;
      while (parent && parent !== document.body && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
      if (tr && parent && parent !== document.body && !isScroller(parent) && !inHorizontalScroller(el)) {
        const p = parent.getBoundingClientRect();
        const over = Math.max(p.left - tr.left, tr.right - p.right, p.top - tr.top, tr.bottom - p.bottom);
        if (over > 2 && getComputedStyle(parent).position !== 'absolute' && p.width > 0 && /(hidden|clip)/.test(getComputedStyle(parent).overflow + getComputedStyle(parent.parentElement || parent).overflow)) {
          found.push({ kind: 'overflow', text, detail: `${desc(el)} exceeds ${desc(parent)} by ${Math.round(over)}px` });
        }
      }
    }

    // covered: once every scroller is at its end, text in the lower part of
    // the screen still sitting under a pinned bar (tab bar, footer CTA,
    // sheet) can never be read. Content under a footer before scrolling, or
    // under the sticky header at the top, is normal and not reported.
    if (phase === 'end' && tr && tr.top >= VH * 0.5 && tr.bottom <= VH && tr.left >= 0 && tr.right <= VW) {
      const pts = [[(tr.left + tr.right) / 2, (tr.top + tr.bottom) / 2], [tr.left + 2, (tr.top + tr.bottom) / 2], [tr.right - 2, (tr.top + tr.bottom) / 2]];
      let hidden = 0;
      let by = null;
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
        const hcs = getComputedStyle(hit);
        // transparent full-screen touch layers are not visual occluders
        const opaque = hcs.backgroundColor !== 'rgba(0, 0, 0, 0)' || hit.querySelector('img') || hit.innerText?.trim();
        if (!opaque) continue;
        const hr = hit.getBoundingClientRect();
        let pinned = false;
        for (let q = hit; q && q !== document.body; q = q.parentElement) {
          if (/(fixed|sticky|absolute)/.test(getComputedStyle(q).position) && q.getBoundingClientRect().bottom >= VH - 120) { pinned = true; break; }
        }
        if (!pinned || hr.top < VH * 0.5) continue;
        hidden += 1;
        by = hit;
      }
      if (hidden >= 2) found.push({ kind: 'covered', text, detail: `${desc(el)} at y=${Math.round(tr.top)} under ${desc(by)} "${label(by).slice(0, 30)}"` });
    }
  }
  return found;
}

/** Runs in the page: scroll every vertical scroller to its end. */
function scrollAllToEnd() {
  let n = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) {
      el.scrollTop = el.scrollHeight;
      n += 1;
    }
  }
  window.scrollTo(0, document.scrollingElement.scrollHeight);
  return n;
}

async function auditRoute(browser, origin, images, spec, sizeId, dynamicType) {
  const [route, ...taps] = spec.split(' >> ').map((x) => x.trim());
  const size = SIZES[sizeId];
  const device = { viewport: size, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  const tag = `${sizeId}${dynamicType ? '+dt' : ''}`;
  const out = [];
  try {
    if (stress) {
      // Registered after the harness's own handler, so it runs first: answer
      // demo-API calls from the same fake data, with names lengthened and
      // counts inflated.
      await context.route('https://api.brandthread.test/**', async (r) => {
        const request = r.request();
        if (request.method() === 'OPTIONS') return r.fallback();
        const url = new URL(request.url());
        const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role, options: {} });
        if (body === undefined) return r.fallback();
        activity.lastApiAt = Date.now();
        return r.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
          body: JSON.stringify(stressBody(body)),
        });
      });
    }
    await openScreen(page, activity, origin, role, route);
    await page.waitForTimeout(1200);
    if (new URL(page.url()).pathname !== route.split('?')[0]) {
      await openScreen(page, activity, origin, role, route);
      await page.waitForTimeout(2000);
    }
    await waitForQuietNetwork(activity, 600, 8000);
    await waitForImages(page, 5000);
    for (const tap of taps) {
      const target = page.getByText(tap, { exact: true }).or(page.getByLabel(tap, { exact: true })).first();
      await target.click({ timeout: 5000 });
      await page.waitForTimeout(900);
    }
    if (dynamicType) {
      await page.evaluate(applyDynamicType, DYNAMIC_TYPE_SCALE);
      await page.waitForTimeout(300);
    }
    const base = shotsDir ? path.join(shotsDir, `${spec.replace(/\W+/g, '_') || 'root'}__${tag}`) : null;
    if (base) await page.screenshot({ path: `${base}__top.png` });
    out.push(...(await page.evaluate(inPageCheck, 'top')));
    const scrolled = await page.evaluate(scrollAllToEnd);
    if (scrolled) {
      await page.waitForTimeout(500);
      if (dynamicType) await page.evaluate(applyDynamicType, DYNAMIC_TYPE_SCALE);
      if (base) await page.screenshot({ path: `${base}__end.png` });
      out.push(...(await page.evaluate(inPageCheck, 'end')));
    }
  } catch (e) {
    out.push({ kind: 'error', text: '', detail: String(e.message).split('\n')[0] });
  } finally {
    await context.close().catch(() => {});
  }
  const seen = new Set();
  return out
    .filter((f) => {
      const k = `${f.kind}|${f.text}|${f.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((f) => ({ route: spec, size: tag, ...f }));
}

async function main() {
  const routes = val('--routes', null)?.split(/,(?=\s*\/)/).filter(Boolean) ?? staticRoutes();
  if (!flag('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const jobs = [];
  for (const route of routes) {
    for (const s of sizeIds) {
      jobs.push([route, s, false]);
      if (flag('--dynamic-type')) jobs.push([route, s, true]);
    }
  }
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [route, s, dt] = jobs[next++];
      const found = await auditRoute(browser, origin, images, route, s, dt);
      results.push(...found);
      console.log(`${found.length ? 'FLAG' : 'ok  '} ${route} @${s}${dt ? '+dt' : ''}${found.length ? `  (${found.length})` : ''}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await browser.close().catch(() => {});
    close();
  }
  results.sort((a, b) => a.route.localeCompare(b.route) || a.size.localeCompare(b.size));
  for (const r of results) console.log(`${r.route} @${r.size}  [${r.kind}]  "${r.text}"  ${r.detail}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`\n${results.length} finding(s) across ${routes.length} route(s) x ${jobs.length / routes.length} config(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
