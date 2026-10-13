#!/usr/bin/env node
/**
 * Cutoff audit (Dev's "no cutoffs anywhere" rule).
 *
 * Loads each route in the demo web build (same fake Clerk/API harness as
 * scripts/text-fit-check.mjs) at three phone sizes, optionally with text
 * scaled to approximate the largest standard Dynamic Type size, and flags
 * anything a person couldn't fully read:
 *
 *   clipped    text whose box is cut by an ancestor that clips (overflow
 *              hidden) and is NOT a scroll container — e.g. a chip row that
 *              runs off the screen edge with no way to scroll to it
 *   offscreen  text past the left/right screen edge that no horizontal
 *              scroller can bring into view
 *   ellipsis   text truncated with an ellipsis inside a button/chip/tab
 *              (truncated labels on controls are never OK)
 *   covered    after scrolling the main scroller to the very end, text that
 *              sits under another layer (tab bar, pinned footer, header) —
 *              i.e. content that can never be scrolled clear
 *   under-top  text above the top safe-area line at scroll position 0
 *   truncated  text cut with an ellipsis / line clamp (judge whether the full
 *              text matters there)
 *   overflow   text spilling out of its own container onto a neighbour
 *
 *   node scripts/cutoff-audit.mjs --role seller --routes /orders,/payouts
 *        [--sizes se,std,max] [--big-text] [--skip-build] [--demo]
 *        [--open-actions] [--build-dir dir] [--shots dir] [--json out.json]
 *
 * `--open-actions` also opens every sheet/menu/modal behind the screen's
 * header actions and its filter / sort / menu / more / add controls (one
 * fresh load per control) and checks whatever opens.
 *
 * `--big-text` multiplies every text node's font size and line height by
 * 1.3 (the DENSE_MAX_FONT_MULTIPLIER cap the app applies at the largest
 * standard Dynamic Type size), since react-native-web has no OS font scale.
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

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SIZES = {
  se: { width: 375, height: 667 },
  std: { width: 390, height: 844 },
  max: { width: 430, height: 932 },
};

export function staticRoutes() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, /^\(.*\)$/.test(n) ? prefix : `${prefix}/${n}`);
      else if (/\.tsx$/.test(n) && !/\.test\./.test(n) && !n.startsWith('_') && !n.startsWith('+') && !n.includes('[')) {
        const base = n.replace(/\.tsx$/, '');
        out.push(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
      }
    }
  };
  walk(path.join(MOBILE_ROOT, 'app'), '');
  return [...new Set(out)].filter((r) => !r.includes('navigation-isolation-probe')).sort();
}

function scaleText(factor) {
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs) el.style.fontSize = `${fs * factor}px`;
    const lh = parseFloat(cs.lineHeight);
    if (lh) el.style.lineHeight = `${lh * factor}px`;
  }
}

function inPageCheck(phase) {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const found = [];
  const label = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const scrollsX = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1;
  const scrollsAny = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY); };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      if (cs.pointerEvents === 'none' && a.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  const textRect = (el) => {
    const range = document.createRange();
    let rect = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        rect = rect
          ? { left: Math.min(rect.left, r.left), right: Math.max(rect.right, r.right), top: Math.min(rect.top, r.top), bottom: Math.max(rect.bottom, r.bottom) }
          : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
    }
    return rect;
  };
  // Only the top-most screen: expo-router keeps covered stack screens in the DOM.
  const isOnTop = (el, tr) => {
    const x = Math.min(VW - 1, Math.max(0, (tr.left + tr.right) / 2));
    const y = Math.min(VH - 1, Math.max(0, (tr.top + tr.bottom) / 2));
    const hit = document.elementFromPoint(x, y);
    return { hit, ok: !!hit && (hit === el || el.contains(hit) || hit.contains(el)) };
  };

  const texts = [...document.querySelectorAll('body *')].filter((el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().replace(/[\u{E000}-\u{F8FF}]/gu, '').length > 0)
    && visible(el));

  for (const el of texts) {
    const tr = textRect(el);
    if (!tr) continue;
    const text = label(el);
    if (!text || /^[\u{E000}-\u{F8FF}\s]+$/u.test(text)) continue; // icon fonts
    const inViewY = tr.bottom > 0 && tr.top < VH;
    if (!inViewY) continue;
    // skip text on a covered stack screen / under a modal
    const centreHit = isOnTop(el, tr);
    const screenCovered = !centreHit.ok && centreHit.hit && !centreHit.hit.closest('[role="button"],button') && phase === 'top';

    // walk ancestors: horizontal scroller? clipping box?
    let inHScroller = false;
    let clipper = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (scrollsX(a)) { inHScroller = true; break; }
      if (scrollsAny(a)) break;
      const cs = getComputedStyle(a);
      if (/(hidden|clip)/.test(cs.overflowX) && !clipper) {
        const r = a.getBoundingClientRect();
        if (tr.right > r.right + 1.5 || tr.left < r.left - 1.5) clipper = { a, over: Math.max(tr.right - r.right, r.left - tr.left) };
      }
    }
    if (phase === 'top') {
      if (!inHScroller && (tr.right > VW + 1 || tr.left < -1)) {
        found.push({ kind: 'offscreen', text, detail: `text ${Math.round(tr.left)}..${Math.round(tr.right)} vs ${VW}` });
      } else if (clipper && !inHScroller && !screenCovered) {
        found.push({ kind: 'clipped', text, detail: `cut ${Math.round(clipper.over)}px by ${clipper.a.tagName.toLowerCase()}${clipper.a.dataset.testid ? `[${clipper.a.dataset.testid}]` : ''}` });
      }
      const cs = getComputedStyle(el);
      const ctrl = el.closest('button, [role="button"], [role="tab"]');
      const cutX = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      const cutY = (clamp || /(hidden|clip)/.test(cs.overflowY)) && el.scrollHeight > el.clientHeight + 2;
      if (cutX || cutY) {
        found.push({
          kind: ctrl ? 'ellipsis' : 'truncated',
          text,
          detail: cutX ? `width ${el.scrollWidth} > ${el.clientWidth}` : `${clamp ? `line-clamp ${cs.webkitLineClamp}` : 'overflow-y'} height ${el.scrollHeight} > ${el.clientHeight}`,
        });
      }
      // text spilling out of its own box (overlapping a neighbour)
      let parent = el.parentElement;
      while (parent && parent !== document.body && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
      if (!inHScroller && parent && parent !== document.body && !scrollsAny(parent) && getComputedStyle(parent).position !== 'absolute') {
        const p = parent.getBoundingClientRect();
        const over = Math.max(p.left - tr.left, tr.right - p.right, p.top - tr.top, tr.bottom - p.bottom);
        if (over > 2 && p.width > 0) found.push({ kind: 'overflow', text, detail: `spills ${Math.round(over)}px out of its container` });
      }
      if (tr.top < 0 && tr.bottom > 0) found.push({ kind: 'under-top', text, detail: `text top ${Math.round(tr.top)}` });
    }
    if (phase === 'bottom' && tr.top < VH && tr.bottom > VH - 140) {
      const { ok, hit } = isOnTop(el, tr);
      if (!ok && hit) {
        const desc = `${hit.tagName.toLowerCase()} "${label(hit).slice(0, 30)}"`;
        found.push({ kind: 'covered', text, detail: `under ${desc} at y=${Math.round(tr.top)}` });
      } else if (tr.bottom > VH + 1) {
        found.push({ kind: 'covered', text, detail: `below the viewport (bottom ${Math.round(tr.bottom)} > ${VH}) at scroll end` });
      }
    }
  }
  return found;
}

/** Labels of the controls that open sheets/menus: header actions + filter/sort/menu/more/add. */
function actionLabels() {
  const out = [];
  for (const el of document.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.top < 0 || r.top > window.innerHeight) continue;
    const l = el.getAttribute('aria-label');
    if (/^(go back|back|close)/i.test(l) || /tab bar|^(home|dashboard|analytics|products|orders|profile|studio)$/i.test(l)) continue;
    const inHeader = r.top < 140;
    if (inHeader || /filter|sort|menu|more|option|choose|add|new|create|edit|select/i.test(l)) out.push(l);
  }
  return [...new Set(out)].slice(0, 8);
}

/** Scrolls every tall vertical scroller (and the window) to its end. */
function scrollToEnd() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  let n = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > window.innerHeight * 0.4) {
      el.scrollTop = el.scrollHeight;
      n += 1;
    }
  }
  return n;
}

async function main() {
  const role = val('--role', 'seller');
  const routes = val('--routes', null)?.split(',').filter(Boolean) ?? staticRoutes();
  const sizes = (val('--sizes', 'se,std,max')).split(',');
  const bigText = flag('--big-text');
  const shotsDir = val('--shots', null);
  const jsonOut = val('--json', null);
  const extraQuery = flag('--demo') ? '&demo=1' : '';
  const buildDir = path.resolve(val('--build-dir', DEFAULT_BUILD_DIR));
  if (!flag('--skip-build') || !existsSync(path.join(buildDir, 'index.html'))) buildPreviewWeb(buildDir);
  const { origin, close } = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const results = [];
  try {
    for (const route of routes) {
      for (const sizeId of sizes) {
        const device = { viewport: SIZES[sizeId], scale: 2, isMobile: true, userAgent: UA };
        const { context, page, activity } = await openContext(browser, { device, role, origin, images });
        const tag = `${route} @${sizeId}${bigText ? '+A' : ''}`;
        try {
          await openScreen(page, activity, origin, role, route, { extraQuery });
          await page.waitForTimeout(1500);
          if (new URL(page.url()).pathname !== route.split('?')[0]) {
            await openScreen(page, activity, origin, role, route, { extraQuery });
            await page.waitForTimeout(2500);
          }
          await waitForQuietNetwork(activity, 600, 8000);
          await waitForImages(page, 5000);
          if (bigText) { await page.evaluate(scaleText, 1.3); await page.waitForTimeout(300); }
          const landed = new URL(page.url()).pathname;
          const base = `${shotsDir ?? ''}/${route.replace(/\W+/g, '_') || 'root'}-${sizeId}${bigText ? '-A' : ''}`;
          const top = await page.evaluate(inPageCheck, 'top');
          if (shotsDir) await page.screenshot({ path: `${base}-top.png` });
          const scrolled = await page.evaluate(scrollToEnd);
          await page.waitForTimeout(500);
          const bottom = scrolled ? await page.evaluate(inPageCheck, 'bottom') : [];
          if (shotsDir && scrolled) await page.screenshot({ path: `${base}-end.png` });
          const actionFindings = [];
          if (flag('--open-actions')) {
            const labels = await page.evaluate(actionLabels);
            for (const l of labels) {
              await openScreen(page, activity, origin, role, route, { extraQuery });
              await page.waitForTimeout(1800);
              await waitForQuietNetwork(activity, 500, 6000);
              if (bigText) { await page.evaluate(scaleText, 1.3); await page.waitForTimeout(200); }
              const btn = page.locator(`[aria-label="${l.replace(/"/g, '\\"')}"]`).first();
              if (!(await btn.isVisible().catch(() => false))) continue;
              await btn.click({ timeout: 3000 }).catch(() => {});
              await page.waitForTimeout(900);
              if (bigText) { await page.evaluate(scaleText, 1.3); await page.waitForTimeout(200); }
              const opened = new URL(page.url()).pathname;
              const found = await page.evaluate(inPageCheck, 'top');
              for (const f of found) actionFindings.push({ ...f, via: `${l}${opened !== landed ? ` → ${opened}` : ''}` });
              if (shotsDir) await page.screenshot({ path: `${base}-act-${l.replace(/\W+/g, '_').slice(0, 40)}.png` });
            }
          }
          const seen = new Set();
          for (const f of [...top, ...bottom, ...actionFindings]) {
            const key = `${f.kind}|${f.text}|${f.via ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({ route, size: sizeId, bigText, landed, ...f });
          }
          console.log(`${seen.size ? 'FLAG' : 'ok  '} ${tag}${landed !== route.split('?')[0] ? `  (landed ${landed})` : ''}${seen.size ? `  (${seen.size})` : ''}`);
        } catch (e) {
          console.log(`ERR  ${tag}  ${String(e.message).split('\n')[0]}`);
          results.push({ route, size: sizeId, bigText, kind: 'error', text: '', detail: String(e.message).split('\n')[0] });
        } finally {
          await context.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    close();
  }
  for (const r of results) console.log(`${r.route} @${r.size}${r.bigText ? '+A' : ''}${r.via ? ` via "${r.via}"` : ''}  [${r.kind}]  "${r.text}"  ${r.detail}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`\n${results.length} finding(s) across ${routes.length} route(s) x ${sizes.length} size(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
