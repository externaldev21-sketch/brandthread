#!/usr/bin/env node
/**
 * Overlap & clipping audit (Playwright, web preview). Renders every route at
 * 390x844 in the same demo web build + fake Clerk/API harness as
 * scripts/cutoff-audit.mjs and scripts/store-screenshots, and flags:
 *
 *   overlap   two visible items (text, icon, control) whose boxes intersect
 *             while neither contains the other
 *   touching  two painted boxes (a pill, card, chip, tile: anything with a
 *             background or border) that overlap or sit edge-to-edge with no
 *             gap, e.g. the Analytics range pill resting on the Visits tile
 *   clipped   an icon, image or control cut off by an ancestor that clips
 *             (overflow hidden), or an icon/small tile sitting on the border
 *             of a rounded, bordered container (the corner shaves it), e.g.
 *             the profile "Professional dashboard" icon tile
 *
 * Only items that are actually on top at their own centre are compared, so
 * content behind a modal, sheet or the floating tab bar is ignored. Overlaps
 * that are part of a design live in ALLOWLIST below, one comment each.
 *
 * Usage:
 *   node scripts/overlap-audit.mjs [--roles buyer,seller] [--routes /a,/b]
 *        [--skip-build] [--json out.json] [--shots dir] [--concurrency 4]
 *
 * Exit code 1 when anything is flagged (0 when clean), so it can gate CI.
 * See docs/overlap-audit.md.
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
const roles = val('--roles', 'buyer,seller').split(',');
const shotsDir = val('--shots', null);
const jsonOut = val('--json', null);
const concurrency = Number(val('--concurrency', 4));
const buildDir = val('--build-dir', DEFAULT_BUILD_DIR);

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 390, height: 844 };

/**
 * Intentional overlaps. Each entry matches a finding (in the page, against
 * the two items' testID / text / aria-label) and says why it is by design.
 * Keep it small: a new entry needs a reason a reviewer would accept.
 */
export const ALLOWLIST = [
  // Count badges (cart, inbox, notifications) sit on the corner of their icon.
  { kind: '*', any: /^\d{1,2}\+?$/, reason: 'count badge on an icon' },
  // The "+" on the avatar is the avatar's own edit badge.
  { kind: '*', testID: /avatar|profile-photo|logo/i, reason: 'edit / story badge on an avatar' },
  // Save hearts, favourite buttons and small labels ("18 yrs", "Sold out")
  // drawn over a product/maker photo inside its card.
  { kind: 'overlap', testID: /save-heart/i, reason: 'save heart on a product photo' },
  { kind: 'overlap', overMedia: true, reason: 'badge or button over a card photo' },
  // Video/reel overlays: captions, rail actions and progress sit on the video by design.
  { kind: 'overlap', testID: /video|reel|feed-item|rail|player/i, reason: 'video overlay controls' },
  // The live-orders globe popover floats over the globe it describes.
  { kind: 'overlap', testID: /globe|map-popover/i, reason: 'globe popover' },
  // A floating action button ("Add product") floats over the list it adds
  // to; the list scrolls out from under it.
  { kind: '*', testID: /-fab$/i, reason: 'floating action button over a list' },
  // Size chart: a table whose header row meets its body rows by design.
  { kind: 'touching', any: /^Size\s+Chest\b/, reason: 'size chart table header row' },
  // Modals and bottom sheets are drawn over the page on purpose.
  { kind: '*', testID: /sheet|modal|backdrop|toast|spotlight|first-run-tip/i, reason: 'modal / sheet / tip layer' },
];

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

/** Runs in the page. Returns findings for what is on screen right now. */
function inPageCheck({ allow }) {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const allowlist = allow.map((a) => ({ ...a, any: a.any && new RegExp(a.any, 'i'), testID: a.testID && new RegExp(a.testID, 'i') }));
  const found = [];
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (let p = el; p; p = p.parentElement) if (Number(getComputedStyle(p).opacity) < 0.05) return false;
    return true;
  };
  const onScreen = (r) => r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < VH && r.right > 0 && r.left < VW;
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
    return rect && { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top };
  };
  const isControl = (el) => el.matches('button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="link"]');
  const isIcon = (el) => el.tagName === 'svg' || el.tagName === 'IMG' || /feather|ionicons|material|fontawesome/i.test(getComputedStyle(el).fontFamily);
  const testIdOf = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const id = p.getAttribute('data-testid');
      if (id) return id;
    }
    return '';
  };
  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${testIdOf(el) ? `[${testIdOf(el)}]` : ''}${t ? ` "${t}"` : ''}`;
  };
  // The smaller item sits entirely on a photo inside the other (a card).
  const overMedia = (a, b) => [[a, b], [b, a]].some(([big, small]) => {
    const imgs = [...big.querySelectorAll('img, [style*="background-image"]')];
    const sr = small.getBoundingClientRect();
    return imgs.some((img) => {
      const ir = img.getBoundingClientRect();
      return sr.left >= ir.left - 1 && sr.right <= ir.right + 1 && sr.top >= ir.top - 1 && sr.bottom <= ir.bottom + 1;
    });
  });
  const allowed = (kind, a, b) => allowlist.some((rule) => {
    if (rule.kind !== '*' && rule.kind !== kind) return false;
    if (rule.overMedia) return !!(a && b) && overMedia(a, b);
    return [a, b].filter(Boolean).some((el) => {
      const text = (el.innerText || el.textContent || '').trim();
      return (rule.any && (rule.any.test(text) || rule.any.test(el.getAttribute('aria-label') || '')))
        || (rule.testID && rule.testID.test(testIdOf(el)));
    });
  });
  // On top at its own centre (so not behind a modal, sheet or tab bar).
  // pointer-events is forced on for the check (see auditRoute), so purely
  // visual layers such as the range pill's glass indicator count too.
  const onTop = (el, r) => {
    const x = Math.min(VW - 1, Math.max(0, (r.left + r.right) / 2));
    const y = Math.min(VH - 1, Math.max(0, (r.top + r.bottom) / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el) || (el.tagName === 'svg' && hit.closest('svg') === el));
  };
  // A painted backdrop (a pill indicator, a card) is usually covered by its
  // own label or by a sibling control: it is "live" when what is on top at
  // its centre belongs to the same local group, not to another layer.
  const paintOnTop = (el, r) => {
    const x = Math.min(VW - 1, Math.max(0, (r.left + r.right) / 2));
    const y = Math.min(VH - 1, Math.max(0, (r.top + r.bottom) / 2));
    const hit = document.elementFromPoint(x, y);
    const group = el.parentElement?.parentElement ?? el;
    return !!hit && (hit === el || el.contains(hit) || group.contains(hit));
  };
  // Pinned chrome (floating tab bar, sticky header, footer CTA): content
  // scrolls underneath it by design; cutoff-audit's "covered" check owns that.
  const pinned = (el) => {
    let bar = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
      // Inside a scroller it is scroll content, however it is positioned
      // (virtualised lists place rows absolutely).
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return false;
      if (cs.position === 'absolute') {
        const r = p.getBoundingClientRect();
        // A bar, not a navigator scene (scenes are absolute and full-screen).
        if (r.width >= VW * 0.5 && r.height < VH * 0.4 && (r.bottom >= VH - 140 || r.top <= 0)) bar = true;
      }
    }
    return bar;
  };
  const inHorizontalScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };

  // The part of a box that can actually be seen: clipped by every
  // scrolling or overflow-hidden ancestor (a row half scrolled under a
  // header, a long label cut by its own ellipsis box).
  const visibleRect = (el, r) => {
    let { left, right, top, bottom } = r;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) continue;
      const pr = p.getBoundingClientRect();
      left = Math.max(left, pr.left); right = Math.min(right, pr.right);
      top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom);
    }
    return right - left >= 1 && bottom - top >= 1 ? { left, right, top, bottom, width: right - left, height: bottom - top } : null;
  };

  // ── Collect items ──────────────────────────────────────────────────────
  const items = [];
  const painted = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) continue;
    const cs = getComputedStyle(el);
    const control = isControl(el) && !el.parentElement.closest('button, a[href], [role="button"], [role="tab"], [role="link"]');
    const icon = isIcon(el) && r.width <= 64 && r.height <= 64;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const vr = visibleRect(el, r);
    const cut = (a, b) => !!b && (Math.abs(a.top - b.top) > 1 || Math.abs(a.bottom - b.bottom) > 1 || Math.abs(a.left - b.left) > 1 || Math.abs(a.right - b.right) > 1);
    // Inline runs (a link inside a paragraph) are part of their block.
    // (react-native-web Text is display:inline; a flex child is blockified,
    // so whatever still computes as inline is a run inside a paragraph.)
    const inline = cs.display === 'inline';
    if (control && vr) items.push({ el, r: vr, type: 'control', partial: cut(r, vr) });
    else if (icon && vr && !el.closest('button, a[href], [role="button"], [role="tab"], [role="link"]')) items.push({ el, r: vr, type: 'icon', partial: cut(r, vr) });
    else if (hasText && !inline && !el.closest('button, a[href], [role="button"], [role="tab"], [role="link"]')) {
      const tr = textRect(el);
      const tv = tr && visibleRect(el, tr);
      if (tv && onScreen(tv) && !/^[\uE000-\uF8FF\s]+$/.test(el.textContent)) items.push({ el, r: tv, type: 'text', partial: cut(tr, tv) });
    }
    // A box reads as a shape when it has a fill or a full outline; a lone
    // bottom border is a list divider, not a box.
    const fullBorder = ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(cs[`border${side}Width`]) > 0);
    const paint = !transparent(cs.backgroundColor) || fullBorder;
    if (paint && r.width >= 12 && r.height >= 12 && r.width < VW - 2 && r.width * r.height < VW * VH * 0.4 && cs.position !== 'fixed') {
      if (vr) painted.push({ el, r: vr, cs, partial: Math.abs(vr.top - r.top) > 1 || Math.abs(vr.bottom - r.bottom) > 1 || Math.abs(vr.left - r.left) > 1 || Math.abs(vr.right - r.right) > 1 });
    }
    // ── clipped: icon / image / control cut by a clipping ancestor ───────
    if ((icon || control || el.tagName === 'IMG') && !inHorizontalScroller(el)) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        if (/(auto|scroll)/.test(pcs.overflowX + pcs.overflowY)) break;
        const pr = p.getBoundingClientRect();
        if (/(hidden|clip)/.test(pcs.overflowX + pcs.overflowY) && pr.width > 0) {
          const bl = parseFloat(pcs.borderLeftWidth) || 0;
          const br = parseFloat(pcs.borderRightWidth) || 0;
          const bt = parseFloat(pcs.borderTopWidth) || 0;
          const bb = parseFloat(pcs.borderBottomWidth) || 0;
          const cut = Math.max(pr.left + bl - r.left, r.right - (pr.right - br), pr.top + bt - r.top, r.bottom - (pr.bottom - bb));
          // A small cut is anti-aliasing; anything bigger than 2px is visible.
          // Images filling a card are clipped to its radius on purpose.
          const fills = r.width >= pr.width - bl - br - 1 || r.height >= pr.height - bt - bb - 1;
          if (cut > 2 && !(el.tagName === 'IMG' && fills) && onTop(el, r) && !allowed('clipped', el, p)) {
            found.push({ kind: 'clipped', a: name(el), b: name(p), detail: `${Math.round(cut)}px cut off` });
          }
          break;
        }
      }
    }
  }

  // ── clipped: a small tile/icon sitting on a rounded bordered edge ───────
  for (const { el, cs } of painted) {
    // Raw boxes: a card half scrolled out of view is not "flush" with the
    // edge of the scroller.
    const r = el.getBoundingClientRect();
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const border = parseFloat(cs.borderLeftWidth) || 0;
    if (radius < 4 || border <= 0) continue;
    const inner = { left: r.left + border, right: r.right - border, top: r.top + border, bottom: r.bottom - border };
    for (const child of el.querySelectorAll('*')) {
      if (child.closest('svg') && child.tagName !== 'svg') continue;
      const ccs = getComputedStyle(child);
      const small = isIcon(child) || (!transparent(ccs.backgroundColor) && child.getBoundingClientRect().width <= 64 && child.getBoundingClientRect().height <= 64);
      if (!small || !visible(child)) continue;
      const c = child.getBoundingClientRect();
      if (c.width < 8 || c.height < 8 || c.width > 64 || c.height > 64) continue;
      const flushL = c.left - inner.left < 1;
      const flushR = inner.right - c.right < 1;
      const flushT = c.top - inner.top < 1;
      const flushB = inner.bottom - c.bottom < 1;
      // Edge-to-edge on one side only: a tile resting on the frame, not a
      // deliberate full-bleed fill.
      if ([flushL, flushR, flushT, flushB].filter(Boolean).length === 1 && !allowed('clipped', child, el)) {
        found.push({ kind: 'clipped', a: name(child), b: name(el), detail: 'sits on the rounded border of its container' });
      }
    }
  }

  // ── overlap: items whose boxes intersect ───────────────────────────────
  const live = items.filter((it) => onTop(it.el, it.r));
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const A = live[i];
      const B = live[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (w < 2 || h < 2) continue;
      // Hairline contact with something scrolled half out of view is the
      // scroller's edge, not a collision.
      if ((A.partial || B.partial) && Math.min(w, h) < 4) continue;
      if (pinned(A.el) !== pinned(B.el)) continue;
      if (allowed('overlap', A.el, B.el)) continue;
      found.push({ kind: 'overlap', a: name(A.el), b: name(B.el), detail: `${Math.round(w)}x${Math.round(h)}px` });
    }
  }

  // ── touching: painted boxes that meet or overlap ───────────────────────
  const livePaint = painted.filter((p) => paintOnTop(p.el, p.r));
  const ownerControl = (el) => el.closest('button, a[href], [role="button"], [role="tab"], [role="link"], [role="switch"]');
  const sameRect = (a, b) => Math.abs(a.left - b.left) < 1.5 && Math.abs(a.right - b.right) < 1.5 && Math.abs(a.top - b.top) < 1.5 && Math.abs(a.bottom - b.bottom) < 1.5;
  for (let i = 0; i < livePaint.length; i += 1) {
    for (let j = i + 1; j < livePaint.length; j += 1) {
      const A = livePaint[i];
      const B = livePaint[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      // Stacked layers of one surface (glass blur + tint) or parts of one
      // control are a single box.
      if (sameRect(A.r, B.r)) continue;
      // A box partly scrolled out of view meets whatever sits at the
      // scroller's edge; it is judged on the pass where it is fully shown.
      if (A.partial || B.partial) continue;
      if (pinned(A.el) !== pinned(B.el)) continue;
      if (ownerControl(A.el) && ownerControl(A.el) === ownerControl(B.el)) continue;
      // A switch's track and thumb (react-native-web draws them as sibling
      // divs next to a hidden checkbox).
      if (A.el.parentElement === B.el.parentElement && A.el.parentElement.querySelector(':scope > input[type="checkbox"], :scope > [role="switch"]')) continue;
      // Siblings inside one painted parent that both paint the same colour
      // are one surface (segments of a single bar), not two boxes.
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      const meetsV = w > 8 && h > -1;
      const meetsH = h > 8 && w > -1;
      if (!meetsV && !meetsH) continue;
      if (A.cs.backgroundColor === B.cs.backgroundColor && A.cs.borderTopWidth === '0px' && B.cs.borderTopWidth === '0px') continue;
      // Rows of one grouped list or table: same column, meeting edge to edge.
      const sameColumn = Math.abs(A.r.left - B.r.left) < 1 && Math.abs(A.r.right - B.r.right) < 1;
      if (sameColumn && h <= 1 && h > -1) continue;
      if (allowed('touching', A.el, B.el)) continue;
      found.push({ kind: 'touching', a: name(A.el), b: name(B.el), detail: w > 0 && h > 0 ? `overlap ${Math.round(w)}x${Math.round(h)}px` : 'no gap' });
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

async function navigate(page, route, role) {
  await page.evaluate((url) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, `${route}${route.includes('?') ? '&' : '?'}bt_preview=${role}`);
}

async function auditRoute(browser, origin, images, role, spec) {
  const [route, ...taps] = spec.split(' >> ').map((x) => x.trim());
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  const out = [];
  const allow = ALLOWLIST.map((a) => ({ ...a, any: a.any?.source, testID: a.testID?.source }));
  try {
    // Land on the app first, put the one-time store-setup sheet away, then
    // route client-side: a cold load of a seller sub-route lands on Home.
    await openScreen(page, activity, origin, role, '/');
    await page.waitForTimeout(2500);
    const later = page.getByText('Continue setup later', { exact: true });
    if (await later.count()) { await later.first().click().catch(() => {}); await page.waitForTimeout(800); }
    const wanted = route.split('?')[0].replace(/\/\([^)]*\)/g, '') || '/';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await navigate(page, route, role);
      await page.waitForTimeout(2500);
      if (new URL(page.url()).pathname === wanted) break;
    }
    await waitForQuietNetwork(activity, 600, 8000);
    await waitForImages(page, 5000);
    for (const tap of taps) {
      const target = page.getByText(tap, { exact: true }).or(page.getByLabel(tap, { exact: true })).first();
      await target.click({ timeout: 5000 });
      await page.waitForTimeout(900);
    }
    // Force hit-testing on for every element so visual-only layers
    // (pointerEvents="none") are seen by elementFromPoint in the check.
    await page.addStyleTag({ content: '* { pointer-events: auto !important; }' });
    const base = shotsDir ? path.join(shotsDir, `${role}${spec.replace(/\W+/g, '_') || '_root'}`) : null;
    if (base) await page.screenshot({ path: `${base}__top.png` });
    out.push(...(await page.evaluate(inPageCheck, { allow })).map((f) => ({ ...f, at: 'top' })));
    if (await page.evaluate(scrollAllToEnd)) {
      await page.waitForTimeout(500);
      if (base) await page.screenshot({ path: `${base}__end.png` });
      out.push(...(await page.evaluate(inPageCheck, { allow })).map((f) => ({ ...f, at: 'end' })));
    }
    out.push({ kind: '_landed', a: new URL(page.url()).pathname });
  } catch (e) {
    out.push({ kind: 'error', a: '', b: '', detail: String(e.message).split('\n')[0] });
  } finally {
    await context.close().catch(() => {});
  }
  const seen = new Set();
  return out
    .filter((f) => {
      const k = `${f.kind}|${f.a}|${f.b}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((f) => ({ role, route: spec, ...f }));
}

async function main() {
  const routes = val('--routes', null)?.split(/,(?=\s*\/)/).filter(Boolean) ?? staticRoutes();
  if (!flag('--skip-build') || !existsSync(path.join(buildDir, 'index.html'))) buildPreviewWeb(buildDir);
  const { origin, close } = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const jobs = roles.flatMap((role) => routes.map((route) => [role, route]));
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [role, route] = jobs[next++];
      const all = await auditRoute(browser, origin, images, role, route);
      const landed = all.find((f) => f.kind === '_landed');
      const found = all.filter((f) => f.kind !== '_landed');
      // A route that redirected (role-gated, needs params) audited a
      // different screen; that screen is covered under its own route.
      const wanted = route.split(' >> ')[0].split('?')[0].replace(/\/\([^)]*\)/g, '') || '/';
      if (landed && landed.a !== wanted) {
        console.log(`skip ${role} ${route}  (landed on ${landed.a})`);
        continue;
      }
      results.push(...found);
      console.log(`${found.length ? 'FLAG' : 'ok  '} ${role} ${route}${found.length ? `  (${found.length})` : ''}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await browser.close().catch(() => {});
    close();
  }
  results.sort((a, b) => a.route.localeCompare(b.route) || a.role.localeCompare(b.role));
  for (const r of results) console.log(`${r.role} ${r.route} [${r.at ?? ''}] ${r.kind}: ${r.a}  ×  ${r.b ?? ''}  ${r.detail ?? ''}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`\n${results.length} finding(s) across ${jobs.length} screen(s)`);
  process.exitCode = results.some((r) => r.kind !== 'error') ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
