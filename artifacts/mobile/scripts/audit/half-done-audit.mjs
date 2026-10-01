#!/usr/bin/env node
/**
 * Whole-app "half-done" audit.
 *
 * Walks every route under app/ (excluding layouts/tests/special files),
 * loads it in both `?bt_preview=seller` and `?bt_preview=buyer` modes at
 * 393x852, taps every visible interactive control one level deep, and flags:
 *
 *   - dead controls (no navigation/modal/state-change/network on tap)
 *   - placeholder/stub copy ("coming soon", TODO, lorem ipsum, undefined, NaN, …)
 *   - repeated/garbage chart or list labels
 *   - console errors / pageerrors / error-boundary fallback UI
 *   - broken images
 *   - clipped or overlapping text
 *   - text-fit & alignment: ellipsis-truncated UI-chrome labels
 *     (truncated-label), text overflowing its own button/chip/card
 *     container (container-overflow), insufficient inner padding
 *     (insufficient-padding), and inconsistent height/width across a row of
 *     sibling buttons/chips (button-row-inconsistent)
 *   - color-rule violations (non-monochrome outside the 3 allowed accents)
 *   - "clarity standard": font family, type scale, min sizes, contrast,
 *     hit-target size, and primary/secondary button-system outliers
 *
 * Reuses the same demo web build + fake Clerk/API preview harness as
 * scripts/store-screenshots/ (see harness.mjs) — no real backend involved.
 *
 * Usage:
 *   node scripts/audit/half-done-audit.mjs [--skip-build] [--only route,route]
 *     [--limit N] [--time-budget-ms N] [--roles seller,buyer]
 *     [--data-states fresh,demo] [--shard-out <path.json>]
 *
 * `--data-states` (default: `fresh`) controls whether each route/role is
 * loaded with a brand-new/empty account (`fresh`, the historical default —
 * no query param) and/or with the app's own `&demo=1` opt-in
 * (`isPreviewDemoMode()`, see lib/devPreview.ts) which switches on the
 * seeded/populated preview datasets (lib/previewInbox.ts, previewOrders.ts,
 * previewSellerProducts.ts, previewActivity.ts, etc). Pass
 * `--data-states fresh,demo` to audit both states — doubles the combination
 * count.
 *
 * `--shard-out <path>` writes this run's raw per-combo results (not the
 * merged report/baseline) to a JSON file instead of the usual
 * docs/audit/half-done-findings.json + report + CI gate, so a long full run
 * can be split into several bounded shard invocations (see `--only` to pick
 * a route slice per shard) and combined afterward with
 * `merge-shard-results.mjs` — see docs/audit/README.md.
 *
 * Output:
 *   docs/audit/half-done-findings.json   — structured findings (this run)
 *   docs/audit/half-done-audit-report.md — human-readable report
 *   artifacts/mobile/docs/audit/screenshots/<route-slug>/*.png
 *
 * CI mode (--ci): loads docs/audit/half-done-baseline.json, and exits 1 if
 * any HARD-tier finding exists that isn't in the baseline (see
 * classifyTier() below for the hard/warn split and README in docs/audit/).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
} from '../store-screenshots/harness.mjs';
import { BUYER_USER, SELLER_USER } from '../store-screenshots/demo-data.mjs';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';
import { ownerForRoute } from './route-ownership.mjs';

const REPO_ROOT = path.resolve(MOBILE_ROOT, '..', '..');
const APP_DIR = path.join(MOBILE_ROOT, 'app');
const OUT_JSON = path.join(REPO_ROOT, 'docs', 'audit', 'half-done-findings.json');
const OUT_MD = path.join(REPO_ROOT, 'docs', 'audit', 'half-done-audit-report.md');
const BASELINE_JSON = path.join(REPO_ROOT, 'docs', 'audit', 'half-done-baseline.json');
const SHOT_DIR = path.join(MOBILE_ROOT, 'docs', 'audit', 'screenshots');
const VIEWPORT = { width: 393, height: 852 };

// ─── Allowed non-monochrome accents (looked up in the codebase, not guessed) ──
// LiveAvatarRing.tsx: LIVE_RED
const LIVE_RED = { r: 0xff, g: 0x3b, b: 0x30 }; // #FF3B30
// CallControls.tsx doc-comment: MUTE_RED/HANG_RED literal, same value in this app
const CALL_RED = { r: 0xff, g: 0x3b, b: 0x30 }; // #FF3B30
// ThreadCashBill.tsx: THREAD_CASH_GREEN_* family
const THREAD_CASH_GREENS = [
  { r: 0x15, g: 0x5c, b: 0x22 }, // deep
  { r: 0x3d, g: 0xbe, b: 0x4f }, // mid
  { r: 0x5f, g: 0xdd, b: 0x70 }, // bright
  { r: 0xcf, g: 0xef, b: 0xc8 }, // paper
];
const ALLOWED_ACCENTS = [LIVE_RED, CALL_RED, ...THREAD_CASH_GREENS];
const HUE_TOLERANCE_DEG = 18; // anti-aliased/opacity blends of the same hue

// ─── theme.ts tokens (read once, verified against source below) ──────────────
const THEME_SRC = readFileSync(path.join(MOBILE_ROOT, 'lib', 'theme.ts'), 'utf8');
function extractFontFamilies(src) {
  const block = src.match(/export const FONT = \{([\s\S]*?)\} as const/)?.[1] ?? '';
  const names = new Set();
  for (const m of block.matchAll(/'([^']+)'\s*as const/g)) names.add(m[1]);
  return [...names];
}
function extractFsScale(src) {
  const block = src.match(/export const FS = \{([\s\S]*?)\} as const/)?.[1] ?? '';
  const vals = new Set();
  for (const m of block.matchAll(/:\s*(\d+)/g)) vals.add(Number(m[1]));
  return [...vals].sort((a, b) => a - b);
}
const INTER_FAMILIES = extractFontFamilies(THEME_SRC); // e.g. Inter_400Regular, Inter_500Medium, ...
const FS_SCALE = extractFsScale(THEME_SRC); // e.g. [11,12,13,15,17,19,22,26,30,36]

// Deliberately NOT included as a bare exact-word match: "Label" and "Title"
// on their own. The original `^Label$|^Title$` rule was meant to catch an
// un-customized default component prop (a control that still literally says
// "Label" because nobody filled it in) but a full fresh+demo run found it
// false-positiving on genuine, deliberately-short domain vocabulary — the
// "Title" field label on the real Add Product form (app/add-product.tsx,
// shared by product-editor.tsx) and the "Label" step in the shipping-status
// tracker's Order/Label/Pickup/Transit/Delivered row (app/shipping.tsx,
// shared by shipping-delivery.tsx) — both real, permanent, correctly-used
// one-word UI copy, not stubs. Same judgement-call treatment as bare
// "sample"/"read-only" below for preview-demo-wording.
const PLACEHOLDER_RE = /coming soon|isn't tracked yet|is not tracked yet|not available yet|TODO\b|lorem ipsum|placeholder|\bundefined\b|\bNaN\b|\$NaN|Invalid Date/i;

// Dev's explicit rule: no visible preview/demo tell anywhere, ever — a fresh
// (empty) real install must read exactly like this text, never like a demo
// harness announcing itself. Matches the same wording purged app-wide (see
// the "Purge preview wording" PRs). Deliberately NOT included: bare "sample"
// (this app has a real, permanent manufacturing "request a sample" /
// "AI logo sample" feature — see app/request-sample.tsx, app/sample-detail.tsx
// — unrelated to preview/demo mode) and bare "read-only" (a real, permanent
// team-role permission label — see app/team.tsx's "Viewer" role — also
// unrelated). Those two stay judgement calls for a human reviewer rather
// than a blanket word match; the higher-risk "read-only preview" combination
// that actually leaked live is still caught below.
const PREVIEW_DEMO_WORDING_RE = /\bpreview\b|\bdemo\b|\bmock\b|placeholder data|test mode|read-only preview|read only preview|until you reload|not load live/i;

// ─── param synthesis for dynamic routes ───────────────────────────────────────
const PARAM_VALUES = {
  id: 'prod_nl_jacket_rust',
  productid: 'prod_nl_jacket_rust',
  itemid: 'prod_nl_jacket_rust',
  listingid: 'prod_nl_jacket_rust',
  variantid: 'prod_nl_jacket_rust_l',
  bundleid: 'prod_nl_jacket_rust',
  orderid: 'so-1',
  disputeid: 'dispute-1',
  returnid: 'return-1',
  customerid: 'user_priya',
  manufacturerid: 'a1c3e5f7-2b4d-4e6f-8a1b-3c5d7e9f1a2b',
  dropid: 'drop_nl_04',
  dropname: 'Drop 04',
  collectionid: 'col_nl_ember',
  threadid: 'th-1',
  username: 'northlinestudio',
  participantuserid: 'user_priya',
  participantname: 'Priya Nandan',
  sellerid: 'seller_northline',
  conversationid: 'preview-conversation-01',
  accounttype: 'seller',
  mode: 'view',
  tab: 'overview',
  role: 'seller',
  filter: 'all',
  step: '1',
};
// Generic fallback for a dynamic-route param with no dedicated
// PARAM_VALUES entry (e.g. buyer-other-profile's userId/name/handle
// /initials/color). Deliberately does NOT contain "preview"/"demo"/"mock":
// several routes render this fallback directly as visible text (a
// profile's name/handle), and an earlier 'preview-1' fallback was
// tripping PREVIEW_DEMO_WORDING_RE — a false "preview/demo wording" hard
// finding caused entirely by the audit harness's own synthesized param
// value, not by real app text. This is separate from the *intentionally*
// preview-prefixed fixture IDs in PARAM_VALUES above (e.g.
// 'preview-conversation-01', matched in lib/previewInboxData.ts) — those
// are real seed keys the app defines and must stay as-is.
function paramValueFor(name) {
  return PARAM_VALUES[name.toLowerCase()] ?? 'sample-1';
}

// ─── route discovery ───────────────────────────────────────────────────────────
const SKIP_BASENAMES = new Set(['_layout.tsx', '+html.tsx', '+not-found.tsx']);
function walkRoutes(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walkRoutes(full)); continue; }
    if (!entry.name.endsWith('.tsx')) continue;
    if (entry.name.endsWith('.test.tsx')) continue;
    if (SKIP_BASENAMES.has(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function fileToRoute(file) {
  let rel = path.relative(APP_DIR, file).replace(/\\/g, '/').replace(/\.tsx$/, '');
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  if (rel === 'index') rel = '';
  const segments = rel.split('/').filter(Boolean);
  const dynamicParams = [];
  const urlSegments = segments.map((seg) => {
    const m = seg.match(/^\[(\.\.\.)?([^\]]+)\]$/);
    if (m) { dynamicParams.push(m[2]); return `${paramValueFor(m[2])}`; }
    return seg;
  });
  const routePath = '/' + urlSegments.join('/');
  return { routePath: routePath === '/' ? '/' : routePath, dynamicParams, segments };
}

function requiredQueryParams(file) {
  const src = readFileSync(file, 'utf8');
  const required = [];
  for (const m of src.matchAll(/useLocalSearchParams<\{([^}]*)\}>/g)) {
    for (const field of m[1].split(';')) {
      const t = field.trim();
      if (!t) continue;
      const [nameRaw] = t.split(':');
      const name = nameRaw.replace('?', '').trim();
      const optional = t.includes('?:');
      if (name && !optional && name !== 'bt_preview' && name !== 'bt_theme' && name !== 'bt_capture') {
        required.push(name);
      }
    }
  }
  return [...new Set(required)];
}

function slugForRoute(routePath) {
  return (routePath === '/' ? 'root' : routePath.replace(/^\//, '')).replace(/[^a-zA-Z0-9_-]+/g, '-');
}

// ─── color helpers ─────────────────────────────────────────────────────────────
function parseRgb(str) {
  const m = str && str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  const [r, g, b, a = 1] = parts;
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b, a };
}
// The app's own grayscale hierarchy (lib/theme.ts FG/TEXT_SECONDARY/
// TEXT_TERTIARY/BG/SURFACE/CARD/...) is a deliberately *cool* grey, not a
// literal r===g===b — e.g. TEXT_SECONDARY #B4B4BC has an 8pt R/B spread.
// tol=11 covers every documented theme.ts grey (max observed spread: 9,
// TEXT_TERTIARY #8A8A93) with headroom, while still flagging a genuinely
// off-hue color (arbitrary blue/purple/orange/yellow has a spread of 30+).
function isMonochrome(rgb, tol = 11) {
  const { r, g, b } = rgb;
  return Math.max(r, g, b) - Math.min(r, g, b) <= tol;
}
function rgbToHueDeg({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function hueDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function matchesAllowedAccent(rgb) {
  const hue = rgbToHueDeg(rgb);
  return ALLOWED_ACCENTS.some((accent) => hueDelta(hue, rgbToHueDeg(accent)) <= HUE_TOLERANCE_DEG);
}
function relLuminance({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(fg, bg) {
  const L1 = relLuminance(fg) + 0.05, L2 = relLuminance(bg) + 0.05;
  return L1 > L2 ? L1 / L2 : L2 / L1;
}

// ─── per-page evaluation of every text/element node (runs in-page) ───────────
const PAGE_SCAN_FN = () => {
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // On-screen only: an element technically laid out (display!=none, not
    // hidden) but scrolled/transformed off the current viewport — e.g. an
    // empty-state message sitting below a horizontally-scrolled chart row —
    // is not something the user can see or tap right now, and comparing its
    // coordinates against an unrelated on-screen element produces bogus
    // "overlap" findings.
    if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    // Walk ancestors for the same three properties. CSS opacity/visibility
    // are NOT inherited computed values — a child's own `opacity` reads `1`
    // even while an ancestor's `opacity: 0` makes it fully invisible on
    // screen — so checking only `el`'s own style missed a real, common
    // pattern in this app: a cross-fade pair (e.g.
    // components/buyer-feed/ShopSideTab.tsx's collapsed/expanded pill
    // strips, both permanently mounted, swapped via animated opacity rather
    // than conditional rendering) where the hidden member is still laid out
    // at its own (often smaller, mid-transition) box size. Before this fix,
    // the text-fit checks below flagged the hidden member's content against
    // its transitional box as a false-positive truncation/overflow —
    // because real text in a 78px-wide collapsed-pill container, which
    // never gets shown that cramped, is not an actual user-facing bug. The
    // first-run-tip components (GestureHintTip/SpotlightTip/
    // AnchoredCardTip/FullScreenGuideTip) don't hit this: they conditionally
    // render (`if (!visible) return null`), not opacity-cross-fade, so this
    // only matters for other already-existing animated UI, but it's a
    // correctness fix for every check in this file, not just the new ones.
    let node = el.parentElement;
    let hops = 0;
    while (node && node !== document.body && hops < 12) {
      const pcs = getComputedStyle(node);
      if (pcs.display === 'none' || pcs.visibility === 'hidden' || Number(pcs.opacity) === 0) return false;
      node = node.parentElement;
      hops += 1;
    }
    return true;
  }
  const ICON_FONT_RE = /feather|material|ionicons?|fontawesome|font awesome|glyphicons?|antdesign|octicons|entypo|evilicons|simplelineicons|zocial|foundation/i;
  function nearestBg(el) {
    let node = el;
    while (node) {
      const cs = getComputedStyle(node);
      const m = cs.backgroundColor && cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s));
        if ((parts[3] ?? 1) > 0.5) return cs.backgroundColor;
      }
      // A gradient (expo-linear-gradient's <LinearGradient>, which renders
      // on web as a plain div with `background-image: linear-gradient(...)`
      // and no `background-color`) is an opaque, real background the app's
      // own buttons rely on (see PrimaryButton) — but its actual color is
      // unknowable from here without rasterizing the canvas. Treating it as
      // "no background found" and walking straight past it to whatever sits
      // behind the button in the DOM (often the page's near-black backdrop)
      // produces a false low-contrast reading against text that's actually
      // sitting on a bright gradient. Stop and report "unknown" instead of
      // guessing either way.
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage)) {
        return null;
      }
      node = node.parentElement;
    }
    return 'rgb(10,10,11)'; // app BG fallback
  }
  // Nearest ancestor that looks like a real "container" (button/chip/card) —
  // has a visible fill or a border — used for the container-overflow and
  // insufficient-padding checks below. Same idea as nearestBg() above but
  // returns the element itself (for its rect/padding), not just a color.
  function nearestContainerEl(el) {
    let node = el.parentElement;
    let hops = 0;
    while (node && node !== document.body && hops < 8) {
      const cs = getComputedStyle(node);
      const bgm = cs.backgroundColor && cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const bgAlpha = bgm ? parseFloat(bgm[1].split(',')[3] ?? '1') : 0;
      const hasBg = bgAlpha > 0.05;
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(cs[`border${side}Width`]) > 0);
      if (hasBg || hasBorder) return node;
      node = node.parentElement;
      hops += 1;
    }
    return null;
  }
  // Heuristic for "this text node is small UI chrome (a button/chip/tab/step
  // label), not a prose paragraph" — per Dev's rule, ellipsis truncation is
  // only ever a bug on the former. A role climbed within a few hops covers a
  // label nested inside its own Text/View inside the pressable; the
  // length+punctuation fallback covers a label with no ARIA role at all
  // (RN Web doesn't always propagate one), the same way a body sentence
  // reads differently from "Processing" or "Fulfillment".
  function isChromeLabelLike(el, text) {
    const trimmed = text.trim();
    // A literal "..." already in the source copy (not the CSS-added ellipsis
    // this check is about) marks an intentional preview/snippet of
    // free-form content — e.g. a small "Notes"-style bubble previewing
    // arbitrary user text — which is prose being clipped on purpose, the
    // same carve-out Dev's rule gives a long caption/body paragraph. Treat
    // it like prose regardless of which role it's nested in.
    if (/\.\.\.$/.test(trimmed) || /…$/.test(trimmed)) return false;
    let node = el;
    for (let i = 0; i < 4 && node; i += 1) {
      const role = node.getAttribute && node.getAttribute('role');
      if (role && ['button', 'tab', 'link'].includes(role)) return true;
      node = node.parentElement;
    }
    return trimmed.length > 0 && trimmed.length <= 24 && !/[.!?]$/.test(trimmed);
  }
  const results = { texts: [], images: [], clickables: [] };
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (!isVisible(el)) continue;
    const hasDirectText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (hasDirectText && el.children.length === 0) {
      const cs = getComputedStyle(el);
      if (ICON_FONT_RE.test(cs.fontFamily)) continue; // vector-icon glyph, not real copy
      const r = el.getBoundingClientRect();
      const text = el.textContent.trim().slice(0, 200);
      const container = nearestContainerEl(el);
      let containerInfo = null;
      if (container) {
        const cr = container.getBoundingClientRect();
        const ccs = getComputedStyle(container);
        const padL = parseFloat(ccs.paddingLeft) || 0;
        const padR = parseFloat(ccs.paddingRight) || 0;
        const padT = parseFloat(ccs.paddingTop) || 0;
        const padB = parseFloat(ccs.paddingBottom) || 0;
        containerInfo = {
          rect: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
          declaredPad: { l: padL, r: padR, t: padT, b: padB },
          // Actual measured clearance between the text's own box and the
          // container's box, each edge — this is what a viewer actually
          // sees, independent of whether it comes from CSS padding, a
          // sibling gap, or the text's own line-height inset.
          measuredPad: {
            l: r.x - cr.x,
            r: cr.x + cr.width - (r.x + r.width),
            t: r.y - cr.y,
            b: cr.y + cr.height - (r.y + r.height),
          },
        };
      }
      const lineClamp = cs.getPropertyValue('-webkit-line-clamp');
      const isLineClamped = lineClamp && lineClamp !== 'none' && Number(lineClamp) > 0;
      results.texts.push({
        text,
        color: cs.color,
        bg: nearestBg(el),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        lineClamp: isLineClamped ? Number(lineClamp) : null,
        whiteSpace: cs.whiteSpace,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        chromeLabel: isChromeLabelLike(el, text),
        container: containerInfo,
      });
    }
  }
  for (const img of document.querySelectorAll('img')) {
    if (!isVisible(img)) continue;
    results.images.push({ src: img.src, naturalWidth: img.naturalWidth, complete: img.complete });
  }
  const clickSel = '[role="button"], [role="link"], [role="tab"], a[href], button, [onclick], [data-testid*="press" i]';
  let idx = 0;
  for (const el of document.querySelectorAll(clickSel)) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    results.clickables.push({
      index: idx++,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      text: el.textContent.trim().slice(0, 80),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      hitSlopHint: el.getAttribute('aria-hit-slop') || cs.padding,
      borderRadius: cs.borderRadius,
    });
  }
  return results;
};

// ─── run one route/role combination ───────────────────────────────────────────
// `dataState` is 'fresh' (brand-new/empty account, historical default) or
// 'demo' (appends `&demo=1`, the app's own populated-preview-dataset opt-in
// — see isPreviewDemoMode() in lib/devPreview.ts).
function withDataState(url, dataState) {
  if (dataState !== 'demo') return url;
  return `${url}${url.includes('?') ? '&' : '?'}demo=1`;
}

async function auditRoute({ browser, origin, role, route, images, budgetMs, maxTaps = 40, dataState = 'fresh' }) {
  const findings = [];
  const consoleErrors = [];
  const startedAt = Date.now();
  const user = role === 'seller' ? SELLER_USER : BUYER_USER;
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined },
    role,
    origin,
    images,
  });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500)); });
  page.on('pageerror', (err) => consoleErrors.push(String(err?.message || err).slice(0, 500)));

  const slug = slugForRoute(route.routePath);
  const shotDir = path.join(SHOT_DIR, slug, role);
  mkdirSync(shotDir, { recursive: true });

  let reachable = true;
  let unreachableReason = null;
  try {
    const target = route.query ? `${route.routePath}?${route.query}` : route.routePath;
    await page.goto(withDataState(`${origin}/?bt_preview=${role}`, dataState), { timeout: 20_000 });
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
    await waitForQuietNetwork(activity, 500, 8_000);
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, withDataState(`${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`, dataState));
    await page.waitForTimeout(900);
    await waitForImages(page, 6_000);
    await waitForQuietNetwork(activity, 500, 6_000);

    let bodyText = await page.evaluate(() => document.body.innerText || '');
    // The client-side history.pushState/popstate navigation above is faster
    // than a full reload, but is occasionally still mid-render (or missed
    // the popstate entirely) when we check — flakily, not per-route, since
    // the same route can pass for one role and blank for the other. Before
    // giving up, retry once with a real full navigation, which always
    // reflects the final route.
    if (bodyText.trim().length < 3) {
      try {
        const fullUrl = withDataState(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`, dataState);
        await page.goto(fullUrl, { timeout: 20_000 });
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
        await waitForQuietNetwork(activity, 500, 8_000);
        await page.waitForTimeout(600);
        await waitForImages(page, 6_000);
        await waitForQuietNetwork(activity, 500, 6_000);
        bodyText = await page.evaluate(() => document.body.innerText || '');
      } catch {
        // fall through — unreachable stands
      }
    }

    // error-boundary fallback detection (components/ErrorBoundary.tsx renders
    // a recognizable "Something went wrong" fallback — checked generically)
    if (/something went wrong|unexpected error|app crashed/i.test(bodyText) && bodyText.length < 4000) {
      findings.push({ type: 'error-boundary', severity: 'hard', detail: 'Error-boundary fallback UI rendered', text: bodyText.slice(0, 300) });
    }
    if (bodyText.trim().length < 3) {
      reachable = false;
      unreachableReason = 'blank page body';
    }
  } catch (err) {
    reachable = false;
    unreachableReason = String(err?.message || err).slice(0, 300);
  }

  if (reachable) {
    await page.screenshot({ path: path.join(shotDir, '00-initial.png') }).catch(() => {});

    const scan = await page.evaluate(PAGE_SCAN_FN).catch(() => ({ texts: [], images: [], clickables: [] }));

    // placeholder copy
    for (const t of scan.texts) {
      if (PLACEHOLDER_RE.test(t.text)) {
        findings.push({ type: 'placeholder-copy', severity: 'hard', detail: `Text matches placeholder pattern: "${t.text}"`, text: t.text });
      }
    }
    // preview/demo wording visible to the user — see PREVIEW_DEMO_WORDING_RE's
    // comment for what's deliberately excluded and why.
    for (const t of scan.texts) {
      if (PREVIEW_DEMO_WORDING_RE.test(t.text)) {
        findings.push({ type: 'preview-demo-wording', severity: 'hard', detail: `Visible text announces preview/demo mode: "${t.text}"`, text: t.text });
      }
    }
    // repeated/garbage labels: 3+ adjacent identical short text nodes in a row (chart ticks / list labels)
    const shortTexts = scan.texts.filter((t) => t.text.length > 0 && t.text.length <= 6);
    const byY = {};
    for (const t of shortTexts) {
      const key = Math.round(t.rect.y / 4);
      (byY[key] ??= []).push(t);
    }
    for (const [, group] of Object.entries(byY)) {
      if (group.length >= 3) {
        const uniq = new Set(group.map((t) => t.text));
        if (uniq.size === 1) {
          // Distinguish a real bug (chart tick labels, a copy-paste bug —
          // nothing tells the repeats apart) from a false positive: several
          // *different* stat cells/cards that legitimately all read the same
          // value (e.g. a fresh seller with 0 published, 0 scheduled, 0
          // drafts, 0 archived posts — see content.tsx's overview row).
          // A legitimate case has its own distinct caption close beneath
          // each repeated value; a genuine bug does not.
          const companions = group.map((item) => {
            let best = null;
            let bestDy = Infinity;
            for (const t of scan.texts) {
              if (group.includes(t)) continue; // ignore other repeated members
              const dy = t.rect.y - item.rect.y;
              const dx = Math.abs(t.rect.x - item.rect.x);
              if (dy > 0 && dy < 40 && dx < 80 && dy < bestDy) { bestDy = dy; best = t.text; }
            }
            return best;
          });
          const distinctCompanions = new Set(companions.filter(Boolean));
          if (distinctCompanions.size < group.length) {
            findings.push({ type: 'repeated-labels', severity: 'hard', detail: `${group.length} adjacent identical labels: "${group[0].text}"`, text: group[0].text });
          }
        }
      }
    }
    // broken images
    for (const img of scan.images) {
      if (img.complete && img.naturalWidth === 0) {
        findings.push({ type: 'broken-image', severity: 'hard', detail: `Image failed to decode: ${img.src}`, text: img.src });
      }
    }
    // clipped single-line text — split into a hard-tier "truncated-label"
    // (ellipsis truncation on small UI chrome — a button/chip/tab/step
    // label: Dev's explicit "never ellipsis a label" rule) vs. the
    // pre-existing warn-tier "clipped-text" (generic overflow:hidden
    // clipping, or ellipsis truncation on a genuinely long prose
    // caption/body paragraph, which the rule explicitly allows). See
    // docs/audit/README.md's "Text-fit & alignment" section for why these
    // are two different tiers rather than one.
    for (const t of scan.texts) {
      const singleLineClipped = t.overflow === 'hidden' && t.whiteSpace === 'nowrap' && t.scrollWidth > t.clientWidth + 2;
      const ellipsisClamped = t.lineClamp === 1 && t.scrollHeight > t.clientHeight + 2;
      const isTruncated = singleLineClipped || ellipsisClamped;
      if (!isTruncated) continue;
      const isEllipsis = t.textOverflow === 'ellipsis' || ellipsisClamped;
      if (isEllipsis && t.chromeLabel) {
        findings.push({
          type: 'truncated-label',
          severity: 'hard',
          detail: `Ellipsis-truncated UI label (${t.scrollWidth || t.scrollHeight}px content into ${t.clientWidth || t.clientHeight}px box): "${t.text}"`,
          text: t.text,
        });
      } else {
        findings.push({ type: 'clipped-text', severity: 'warn', detail: `Text clipped (${t.scrollWidth}px into ${t.clientWidth}px): "${t.text}"`, text: t.text });
      }
    }
    // container-overflow (hard): text's own box extends past the border box
    // of its nearest button/chip/card-style ancestor — "text touches or
    // overflows its container" is unambiguous once measured, no design
    // judgment call involved, so this is gated immediately rather than
    // tracked as debt like the padding-degree check below.
    //
    // Capped at MAX_PLAUSIBLE_OVERFLOW_PX: nearestContainerEl() (above) is a
    // DOM-climbing heuristic, not real layout attribution — on a screen
    // where the real visual "container" has no fill/border of its own (text
    // sitting directly over a photo/video, no card chrome), it can climb
    // past the right element onto some unrelated, much bigger bordered
    // ancestor several hops up. That produces a huge, physically-implausible
    // "overflow" (seen in practice: hundreds of px, next to the font-size-
    // scale handful-of-px a real clipped/overflowing label produces) — a
    // mismeasurement, not a real bug, and at hard tier's zero-tolerance gate
    // (see docs/audit/README.md) a single one of these would permanently
    // fail CI app-wide. A real "text touches/overflows its box" bug is on
    // the order of single-digit-to-a-few-dozen px, matching how far text
    // naturally spills past a slightly-too-small padding — not hundreds.
    const MAX_PLAUSIBLE_OVERFLOW_PX = 48;
    for (const t of scan.texts) {
      if (!t.container) continue;
      const { measuredPad } = t.container;
      const overflows = [measuredPad.l, measuredPad.r, measuredPad.t, measuredPad.b].filter((v) => v < -0.5);
      const overflowing = overflows.length > 0 && overflows.every((v) => v >= -MAX_PLAUSIBLE_OVERFLOW_PX);
      if (overflowing) {
        findings.push({
          type: 'container-overflow',
          severity: 'hard',
          detail: `Text box overflows its container by (l${measuredPad.l.toFixed(1)},r${measuredPad.r.toFixed(1)},t${measuredPad.t.toFixed(1)},b${measuredPad.b.toFixed(1)})px: "${t.text}"`,
          text: t.text,
        });
      }
    }
    // insufficient inner padding (warn): text sits inside its container but
    // closer to the edge than the stated minimums — 12px horizontal for a
    // button/chip-sized container (height <= 56px, the rough ceiling for a
    // single-line control), 16px horizontal for a larger card-style
    // container. This is a measured heuristic (guessing "button vs. card"
    // from height alone, like the existing button-clustering heuristic
    // below), not a hard binary rule, so it stays warn-tier — see
    // docs/audit/README.md.
    for (const t of scan.texts) {
      if (!t.container) continue;
      const { measuredPad, rect: cRect } = t.container;
      if (measuredPad.l < -0.5 || measuredPad.r < -0.5) continue; // already a container-overflow finding
      const isButtonSized = cRect.h <= 56;
      const minH = isButtonSized ? 12 : 16;
      const worstH = Math.min(measuredPad.l, measuredPad.r);
      if (worstH >= 0 && worstH < minH) {
        findings.push({
          type: 'insufficient-padding',
          severity: 'warn',
          detail: `Only ${worstH.toFixed(1)}px horizontal clearance to its ${isButtonSized ? 'button/chip' : 'card'} container (need >=${minH}px): "${t.text}"`,
          text: t.text,
        });
      }
    }
    // overlapping text (bounding box overlap > 30% of smaller area)
    for (let i = 0; i < scan.texts.length; i += 1) {
      for (let j = i + 1; j < scan.texts.length; j += 1) {
        const a = scan.texts[i].rect, b = scan.texts[j].rect;
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        const overlapArea = ox * oy;
        const minArea = Math.min(a.w * a.h, b.w * b.h);
        if (minArea > 0 && overlapArea / minArea > 0.3 && scan.texts[i].text !== scan.texts[j].text) {
          findings.push({ type: 'overlapping-text', severity: 'warn', detail: `"${scan.texts[i].text}" overlaps "${scan.texts[j].text}"` });
          break;
        }
      }
    }
    // color-rule violations
    const colorSeen = new Set();
    for (const t of scan.texts) {
      const rgb = parseRgb(t.color);
      if (!rgb) continue;
      if (!isMonochrome(rgb) && !matchesAllowedAccent(rgb)) {
        const key = `${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)}`;
        if (!colorSeen.has(key)) {
          colorSeen.add(key);
          findings.push({ type: 'color-rule-violation', severity: 'warn', detail: `Non-monochrome, non-allowed color ${t.color} on "${t.text}"`, text: t.text });
        }
      }
    }
    // font family
    for (const t of scan.texts) {
      const usesInter = INTER_FAMILIES.some((f) => t.fontFamily.includes(f));
      if (!usesInter) {
        findings.push({ type: 'font-family', severity: 'warn', detail: `Non-Inter font-family "${t.fontFamily}" on "${t.text}"`, text: t.text });
      }
    }
    // type scale
    for (const t of scan.texts) {
      const nearest = FS_SCALE.reduce((best, v) => (Math.abs(v - t.fontSize) < Math.abs(best - t.fontSize) ? v : best), FS_SCALE[0]);
      if (Math.abs(nearest - t.fontSize) > 0.5) {
        findings.push({ type: 'type-scale-drift', severity: 'warn', detail: `font-size ${t.fontSize}px not on declared FS scale (nearest ${nearest}) on "${t.text}"`, text: t.text });
      }
    }
    // min sizes (13pt body / 11pt caption floor — flag anything under 11px outright, 11-13px as caption-only concern)
    for (const t of scan.texts) {
      if (t.fontSize < 11) {
        findings.push({ type: 'min-size-violation', severity: 'warn', detail: `font-size ${t.fontSize}px below the 11pt caption floor on "${t.text}"`, text: t.text });
      }
    }
    // contrast
    for (const t of scan.texts) {
      const fg = parseRgb(t.color);
      const bg = parseRgb(t.bg);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      const isLarge = t.fontSize >= 18 || (t.fontSize >= 14 && Number(t.fontWeight) >= 700);
      const min = isLarge ? 3 : 4.5;
      if (ratio < min) {
        findings.push({ type: 'contrast-violation', severity: 'warn', detail: `contrast ${ratio.toFixed(2)}:1 (need ${min}:1) for "${t.text}" — ${t.color} on ${t.bg}`, text: t.text });
      }
    }
    // hit-target size
    for (const c of scan.clickables) {
      if (c.rect.w < 44 || c.rect.h < 44) {
        findings.push({ type: 'hit-target-too-small', severity: 'warn', detail: `${c.rect.w.toFixed(0)}x${c.rect.h.toFixed(0)}px control "${c.text || c.role}" under 44x44 (hitSlop not verifiable from DOM)` });
      }
    }
    // button-row-inconsistent (warn): cluster clickables that sit in the same
    // visual row (same vertical band, roughly the app's own row-gap apart
    // horizontally) and flag the group if its members' heights or widths
    // vary too much to read as a real grid — Dev's explicit "equal height
    // AND equal width, no ragged 2-wide-+-2-different-width layout" rule.
    // Same clustering approach as the pre-existing button/type-scale
    // outlier-from-the-mode heuristics elsewhere in this file: groups, not a
    // hard per-element binary, so this stays warn-tier like the other
    // clustering-based checks (see docs/audit/README.md).
    {
      const rowByBand = {};
      for (const c of scan.clickables) {
        // A real "grid of buttons" is short controls (chips/segmented
        // buttons/step actions), not e.g. a tall card that also happens to
        // be a pressable — cap out generously above the tallest real
        // button in this app's scale.
        if (c.rect.h > 72 || c.rect.h <= 0 || c.rect.w <= 0) continue;
        const key = Math.round(c.rect.y / 6);
        (rowByBand[key] ??= []).push(c);
      }
      for (const [, row] of Object.entries(rowByBand)) {
        if (row.length < 2) continue;
        const sorted = [...row].sort((a, b) => a.rect.x - b.rect.x);
        const heights = sorted.map((c) => c.rect.h);
        const widths = sorted.map((c) => c.rect.w);
        const maxH = Math.max(...heights), minH = Math.min(...heights);
        const maxW = Math.max(...widths), minW = Math.min(...widths);
        const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
        // >6px height mismatch, or >25% width mismatch relative to the
        // row's average width, in a row of 2+ button-like controls.
        const heightMismatch = maxH - minH > 6;
        const widthMismatch = avgW > 0 && (maxW - minW) / avgW > 0.25;
        if (heightMismatch || widthMismatch) {
          const label = sorted.map((c) => `"${c.text || c.role}" ${c.rect.w.toFixed(0)}x${c.rect.h.toFixed(0)}`).join(', ');
          findings.push({
            type: 'button-row-inconsistent',
            severity: 'warn',
            detail: `${sorted.length} controls in one row have mismatched ${heightMismatch ? 'heights' : ''}${heightMismatch && widthMismatch ? '/' : ''}${widthMismatch ? 'widths' : ''}: ${label}`,
          });
        }
      }
    }

    // tap every visible clickable one level deep, reload between taps
    const clickables = scan.clickables.slice(0, maxTaps); // cap per route/role so one control-heavy screen can't blow the budget
    for (const c of clickables) {
      if (Date.now() - startedAt > budgetMs) break;
      try {
        const beforeUrl = page.url();
        const beforeErrCount = consoleErrors.length;
        const beforeApiAt = activity.lastApiAt;
        const dialogText = { value: null };
        const onDialog = async (dialog) => { dialogText.value = dialog.message(); await dialog.dismiss().catch(() => {}); };
        page.on('dialog', onDialog);

        const handle = await page.evaluateHandle((sel, idx) => {
          const els = [...document.querySelectorAll(sel)].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          return els[idx] || null;
        }, '[role="button"], [role="link"], [role="tab"], a[href], button, [onclick], [data-testid*="press" i]', c.index);

        const el = handle.asElement();
        if (el) {
          const beforeHtmlLen = (await page.content()).length;
          await el.click({ timeout: 3_000, force: true }).catch(() => {});
          await page.waitForTimeout(500);
          const afterHtmlLen = (await page.content()).length;
          const afterUrl = page.url();
          const navigated = afterUrl !== beforeUrl;
          const domChanged = Math.abs(afterHtmlLen - beforeHtmlLen) > 20;
          const networked = activity.lastApiAt !== beforeApiAt;
          const newErrors = consoleErrors.slice(beforeErrCount);

          if (dialogText.value && PLACEHOLDER_RE.test(dialogText.value)) {
            findings.push({ type: 'placeholder-copy', severity: 'hard', detail: `Alert on tap of "${c.text || c.role}": "${dialogText.value}"`, text: dialogText.value, control: c.text || c.role });
          }
          if (!navigated && !domChanged && !networked && !dialogText.value) {
            findings.push({ type: 'dead-control', severity: 'hard', detail: `Tapping "${c.text || c.role}" produced no navigation, no DOM change, no network activity, and no dialog`, control: c.text || c.role, rect: c.rect });
            await page.screenshot({ path: path.join(shotDir, `dead-${c.index}.png`) }).catch(() => {});
          }
          if (newErrors.length) {
            findings.push({ type: 'console-error-on-tap', severity: 'hard', detail: `Console error after tapping "${c.text || c.role}": ${newErrors[0]}`, control: c.text || c.role });
          }
        }
        page.off('dialog', onDialog);
      } catch {
        // never let one bad control hang the whole route
      }
      // reset for the next tap
      try {
        await page.goto(withDataState(`${origin}/?bt_preview=${role}`, dataState), { timeout: 10_000 });
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 10_000 }).catch(() => {});
        await waitForQuietNetwork(activity, 300, 4_000);
        const target = route.query ? `${route.routePath}?${route.query}` : route.routePath;
        await page.evaluate((url) => {
          history.pushState(history.state, '', url);
          window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        }, withDataState(`${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`, dataState));
        await page.waitForTimeout(400);
      } catch {
        break; // reload itself failing — stop tapping this route/role, keep findings so far
      }
    }

    if (consoleErrors.length) {
      const uniq = [...new Set(consoleErrors)].slice(0, 10);
      for (const e of uniq) {
        findings.push({ type: 'console-error', severity: 'hard', detail: e });
      }
    }
  }

  await context.close().catch(() => {});
  return { reachable, unreachableReason, findings, shotDir: path.relative(MOBILE_ROOT, shotDir) };
}

// ─── main ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    skipBuild: false, only: null, limit: null, timeBudgetMs: null, roles: ['seller', 'buyer'],
    ci: false, perRouteBudgetMs: 45_000, maxTaps: 40, dataStates: ['fresh'], shardOut: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skip-build') opts.skipBuild = true;
    else if (a === '--only') opts.only = argv[++i].split(',');
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--time-budget-ms') opts.timeBudgetMs = Number(argv[++i]);
    else if (a === '--per-route-budget-ms') opts.perRouteBudgetMs = Number(argv[++i]);
    else if (a === '--roles') opts.roles = argv[++i].split(',');
    else if (a === '--max-taps') opts.maxTaps = Number(argv[++i]);
    else if (a === '--ci') opts.ci = true;
    else if (a === '--data-states') opts.dataStates = argv[++i].split(',');
    else if (a === '--shard-out') opts.shardOut = argv[++i];
  }
  return opts;
}

function classifyTier(finding) {
  // hard-fail tier: console errors, dead controls, placeholder copy, broken
  // images, repeated-labels, error boundaries, truncated-label,
  // container-overflow — things that should never regress and are cheap to
  // keep at zero-new (the last two added for the text-fit & alignment audit;
  // see docs/audit/README.md).
  // warn tier: color/type-scale/contrast/hit-target/clipped/overlap/button-
  // row-inconsistent/insufficient-padding — pervasive pre-existing debt or a
  // clustering/degree-based heuristic, out of scope to hard-gate; tracked
  // but non-blocking for now.
  return finding.severity === 'hard' ? 'hard' : 'warn';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  mkdirSync(SHOT_DIR, { recursive: true });

  const routeFiles = walkRoutes(APP_DIR);
  let routes = routeFiles.map((file) => {
    const { routePath, dynamicParams } = fileToRoute(file);
    const required = requiredQueryParams(file);
    const queryParts = [];
    for (const p of required) queryParts.push(`${p}=${encodeURIComponent(paramValueFor(p))}`);
    return {
      file: path.relative(MOBILE_ROOT, file),
      routePath,
      dynamicParams,
      requiredParams: required,
      query: queryParts.join('&'),
    };
  });
  if (opts.only) routes = routes.filter((r) => opts.only.some((o) => r.routePath.includes(o) || r.file.includes(o)));
  if (opts.limit) routes = routes.slice(0, opts.limit);

  console.log(`Discovered ${routeFiles.length} route files; auditing ${routes.length} across roles [${opts.roles.join(', ')}] and data-states [${opts.dataStates.join(', ')}].`);

  if (!opts.skipBuild) {
    console.log('Building preview web export…');
    buildPreviewWeb();
  } else if (!existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    throw new Error('--skip-build passed but no existing build found; run without --skip-build once.');
  }

  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  let browser = await launchBrowser();

  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));

  const results = [];
  const overallStart = Date.now();
  const globalBudget = opts.timeBudgetMs ?? Infinity;
  let interrupted = false;

  // A crashed/killed Chromium process (OOM under resource contention from
  // other concurrent Playwright processes on the same box is the observed
  // cause) leaves `browser` disconnected; every subsequent
  // openContext()/page call then throws "Target page, context or browser
  // has been closed", which — before this fix — silently fell through to
  // the generic catch below and got recorded as a per-route "unreachable"
  // finding for every remaining route in the run, a false-negative cascade
  // (the routes aren't actually broken, the browser process is dead). Detect
  // that specific failure, relaunch the browser, and retry the current
  // route once before giving up on it.
  const BROWSER_DIED_RE = /Target page, context or browser has been closed|Browser has been closed|Browser closed|has been closed$/i;
  async function runOneCombo(route, role, dataState) {
    return Promise.race([
      auditRoute({ browser, origin, role, route, images, budgetMs: opts.perRouteBudgetMs, maxTaps: opts.maxTaps, dataState }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('route timed out')), opts.perRouteBudgetMs + 15_000)),
    ]);
  }

  outer:
  for (const route of routes) {
    for (const role of opts.roles) {
      for (const dataState of opts.dataStates) {
        if (Date.now() - overallStart > globalBudget) { interrupted = true; break outer; }
        if (!browser.isConnected()) {
          console.log('  [browser was disconnected before this route — relaunching]');
          await browser.close().catch(() => {});
          browser = await launchBrowser();
        }
        process.stdout.write(`  [${role}/${dataState}] ${route.routePath}${route.query ? '?' + route.query : ''} … `);
        try {
          const r = await runOneCombo(route, role, dataState);
          results.push({ route: route.routePath, file: route.file, role, dataState, ...r });
          console.log(r.reachable ? `${r.findings.length} finding(s)` : `unreachable (${r.unreachableReason})`);
        } catch (err) {
          const msg = String(err?.message || err);
          if (BROWSER_DIED_RE.test(msg)) {
            console.log(`browser crashed (${msg.slice(0, 80)}) — relaunching and retrying once`);
            await browser.close().catch(() => {});
            browser = await launchBrowser();
            try {
              const r = await runOneCombo(route, role, dataState);
              results.push({ route: route.routePath, file: route.file, role, dataState, ...r });
              console.log(`  [retry] ${r.reachable ? `${r.findings.length} finding(s)` : `unreachable (${r.unreachableReason})`}`);
              continue;
            } catch (err2) {
              results.push({ route: route.routePath, file: route.file, role, dataState, reachable: false, unreachableReason: `browser crashed, retry also failed: ${String(err2?.message || err2)}`.slice(0, 300), findings: [] });
              console.log(`  [retry] ERROR: ${err2?.message || err2}`);
              continue;
            }
          }
          results.push({ route: route.routePath, file: route.file, role, dataState, reachable: false, unreachableReason: msg.slice(0, 300), findings: [] });
          console.log(`ERROR: ${msg}`);
        }
      }
    }
  }

  await browser.close().catch(() => {});
  close();

  const flat = [];
  for (const r of results) {
    for (const f of r.findings) {
      flat.push({ ...f, route: r.route, file: r.file, role: r.role, dataState: r.dataState, tier: classifyTier(f), screenshotDir: r.shotDir, owner: ownerForRoute(r.route) });
    }
  }

  if (opts.shardOut) {
    // Shard mode: dump raw combo results for later merging (see
    // merge-shard-results.mjs) instead of writing the top-level report/CI
    // gate, which only make sense once every shard has been combined.
    mkdirSync(path.dirname(opts.shardOut), { recursive: true });
    writeFileSync(opts.shardOut, JSON.stringify({
      generatedAt: new Date().toISOString(),
      interrupted,
      routesDiscovered: routeFiles.length,
      results: results.map((r) => ({ route: r.route, role: r.role, dataState: r.dataState, file: r.file, reachable: r.reachable, unreachableReason: r.unreachableReason, findings: r.findings, shotDir: r.shotDir })),
    }, null, 2));
    console.log(`\nShard wrote ${results.length} combo result(s) to ${opts.shardOut}`);
    return;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    interrupted,
    routesDiscovered: routeFiles.length,
    routesAudited: results.length,
    unreachable: results.filter((r) => !r.reachable).map((r) => ({ route: r.route, role: r.role, dataState: r.dataState, reason: r.unreachableReason })),
    findingsByType: {},
    findingsByTier: { hard: 0, warn: 0 },
  };
  for (const f of flat) {
    summary.findingsByType[f.type] = (summary.findingsByType[f.type] || 0) + 1;
    summary.findingsByTier[f.tier] += 1;
  }

  writeFileSync(OUT_JSON, JSON.stringify({ summary, findings: flat, results: results.map((r) => ({ route: r.route, role: r.role, dataState: r.dataState, reachable: r.reachable, unreachableReason: r.unreachableReason, file: r.file })) }, null, 2));
  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`Findings: ${flat.length} (hard: ${summary.findingsByTier.hard}, warn: ${summary.findingsByTier.warn})`);

  writeMarkdown(summary, flat, results);

  if (opts.ci) {
    const exitCode = ciGate(flat);
    process.exit(exitCode);
  }
}

function groupArea(route) {
  const r = route.toLowerCase();
  if (r.startsWith('/(tabs)') || r.includes('analytics') || r.includes('dashboard') || r.includes('seller-')) return 'Seller dashboard / analytics';
  if (r.includes('discover') || r.includes('feed') || r.includes('/c/') || r.includes('/u/') || r.includes('drops')) return 'Buyer discover / feed';
  if (r.includes('inbox') || r.includes('chat') || r.includes('thread') || r.includes('message')) return 'Messaging';
  if (r.includes('live')) return 'Live';
  if (r.includes('checkout') || r.includes('cart') || r.includes('order')) return 'Checkout / orders';
  if (r.includes('profile') || r.includes('settings') || r.includes('account') || r.includes('billing') || r.includes('privacy') || r.includes('security')) return 'Profile / settings';
  if (r.includes('manufacturer')) return 'Manufacturer hub';
  if (r.includes('ai-') || r.includes('studio')) return 'AI / Studio tools';
  if (r.includes('product')) return 'Products';
  return 'Other';
}

function writeMarkdown(summary, flat, results = []) {
  const byArea = {};
  for (const f of flat) {
    const area = groupArea(f.route);
    (byArea[area] ??= []).push(f);
  }
  const areaOrder = Object.keys(byArea).sort((a, b) => byArea[b].length - byArea[a].length);

  // ─── per-owner scoreboard ────────────────────────────────────────────────
  // Per unique route (not per route×role×dataState combo): hard/warn finding
  // counts, whether it's entirely finding-free, and whether it's "still
  // failing" (unreachable in at least one combo, or has at least one
  // hard-tier finding anywhere).
  const routeOwner = new Map();
  const routeHard = new Map();
  const routeWarn = new Map();
  const routeUnreachable = new Set();
  for (const f of flat) {
    routeOwner.set(f.route, f.owner ?? ownerForRoute(f.route));
    if (f.tier === 'hard') routeHard.set(f.route, (routeHard.get(f.route) || 0) + 1);
    else routeWarn.set(f.route, (routeWarn.get(f.route) || 0) + 1);
  }
  for (const r of results) {
    if (!routeOwner.has(r.route)) routeOwner.set(r.route, ownerForRoute(r.route));
    if (!r.reachable) routeUnreachable.add(r.route);
  }
  const ownerStats = {};
  for (const [route, owner] of routeOwner) {
    const s = (ownerStats[owner] ??= { hard: 0, warn: 0, routes: 0, zeroFindingRoutes: 0, failingRoutes: 0 });
    s.routes += 1;
    const hard = routeHard.get(route) || 0;
    const warn = routeWarn.get(route) || 0;
    s.hard += hard;
    s.warn += warn;
    if (hard === 0 && warn === 0 && !routeUnreachable.has(route)) s.zeroFindingRoutes += 1;
    if (hard > 0 || routeUnreachable.has(route)) s.failingRoutes += 1;
  }
  const ownerOrder = Object.keys(ownerStats).sort((a, b) => ownerStats[b].hard - ownerStats[a].hard);

  const lines = [];
  lines.push('# Half-done audit report');
  lines.push('');
  lines.push(`Generated ${summary.generatedAt}${summary.interrupted ? ' (partial run — time budget hit)' : ''}.`);
  lines.push('');
  lines.push(`- Route files discovered: ${summary.routesDiscovered}`);
  lines.push(`- Route × role combinations audited: ${summary.routesAudited}`);
  lines.push(`- Unreachable: ${summary.unreachable.length}`);
  lines.push(`- Total findings: ${flat.length} (hard: ${summary.findingsByTier.hard}, warn: ${summary.findingsByTier.warn})`);
  lines.push('');
  lines.push('## Scoreboard by area/owner');
  lines.push('');
  lines.push('Each owning session\'s row — see `route-ownership.mjs`/`route-ownership.json` for the mapping rules and `docs/audit/README.md` for the heuristic writeup. Counts are per unique route (not per route×role×data-state combo): a route counts once toward "zero-finding routes" only if it produced no hard AND no warn finding under any role/state it was audited in, and once toward "routes still failing" if it has any hard-tier finding or was unreachable under any role/state.');
  lines.push('');
  lines.push('| Area/owner | Hard | Warn | Routes | Zero-finding routes | Routes still failing |');
  lines.push('|---|---|---|---|---|---|');
  for (const owner of ownerOrder) {
    const s = ownerStats[owner];
    lines.push(`| ${owner} | ${s.hard} | ${s.warn} | ${s.routes} | ${s.zeroFindingRoutes} | ${s.failingRoutes} |`);
  }
  lines.push('');
  lines.push('## Notes on this run');
  lines.push('');
  const fullyCovered = !summary.interrupted && summary.routesAudited >= summary.routesDiscovered * 4;
  lines.push(
    fullyCovered
      ? 'This run has full coverage: every route × role × data-state combination discovered was audited. One caveat found while producing it:'
      : 'This is a time-budgeted pass, not full coverage — see `routesAudited` vs `routesDiscovered` above. One caveat found while producing it:',
  );
  lines.push('');
  lines.push('- **Group-root layouts under the "wrong" role are expected unreachable, not bugs**: `/(tabs)` is the seller tab root and `/(buyer)` is the buyer tab root — a `/(tabs)` load under `?bt_preview=buyer` (or vice versa) correctly renders nothing, the same way a signed-in buyer account would never land on the seller shell. Do not treat those specific role/route pairings in the Unreachable table below as findings.');
  lines.push('');
  lines.push('An earlier version of this script flagged the *matching*-role case (e.g. `/(tabs)` under `seller`) as unreachable too, flakily — the fast client-side `history.pushState`/`popstate` navigation used between routes was occasionally still mid-render when the reachability check ran. The script now retries once with a real full-page reload before giving up, which fixed that: unreachable dropped from 72% of routes in the initial sample to a small handful in a full run. A route/role pair that still shows unreachable below reflects a real full-navigation blank body — either a genuine redirect-only route with no rendered content, or worth a closer look.');
  lines.push('');
  lines.push('## Known, being rebuilt separately');
  lines.push('');
  lines.push('The seller dashboard revenue chart (repeated axis labels, misaligned curve, no value on tap) is already being rebuilt in a separate session (019SGXKf). Findings from `/(tabs)` (seller dashboard root) related to that specific chart are listed below for completeness but should NOT be picked up by a follow-up fix PR — check with that session before touching it.');
  lines.push('');
  lines.push('## Findings by type');
  lines.push('');
  lines.push('| Type | Tier | Count |');
  lines.push('|---|---|---|');
  for (const [type, count] of Object.entries(summary.findingsByType).sort((a, b) => b[1] - a[1])) {
    const tier = flat.find((f) => f.type === type)?.tier ?? '';
    lines.push(`| ${type} | ${tier} | ${count} |`);
  }
  lines.push('');
  lines.push('## Unreachable routes');
  lines.push('');
  if (summary.unreachable.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Route | Role | Data state | Reason |');
    lines.push('|---|---|---|---|');
    for (const u of summary.unreachable) lines.push(`| \`${u.route}\` | ${u.role} | ${u.dataState ?? 'fresh'} | ${u.reason ?? ''} |`);
  }
  lines.push('');
  lines.push('## Findings by area (audit-script grouping, not the owner scoreboard above)');
  lines.push('');
  for (const area of areaOrder) {
    const items = byArea[area].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'hard' ? -1 : 1));
    lines.push(`### ${area} (${items.length})`);
    lines.push('');
    lines.push('| Route | Role | Data state | Type | Tier | Detail | Screenshot |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const f of items.slice(0, 300)) {
      const shot = f.screenshotDir ? `[view](../../${f.screenshotDir}/00-initial.png)` : '';
      const detail = (f.detail || '').replace(/\|/g, '\\|').slice(0, 160);
      lines.push(`| \`${f.route}\` | ${f.role} | ${f.dataState ?? 'fresh'} | ${f.type} | ${f.tier} | ${detail} | ${shot} |`);
    }
    lines.push('');
  }
  writeFileSync(OUT_MD, lines.join('\n'));
  console.log(`Wrote ${OUT_MD}`);
}

function ciGate(flat) {
  let baseline = { hardKeys: [] };
  if (existsSync(BASELINE_JSON)) {
    baseline = JSON.parse(readFileSync(BASELINE_JSON, 'utf8'));
  }
  const baselineSet = new Set(baseline.hardKeys || []);
  const hard = flat.filter((f) => f.tier === 'hard');
  const newHard = hard.filter((f) => !baselineSet.has(findingKey(f)));
  if (newHard.length > 0) {
    console.error(`\nCI GATE FAILED: ${newHard.length} new hard-tier finding(s) not in baseline:`);
    for (const f of newHard.slice(0, 50)) console.error(`  [${f.type}] ${f.route} (${f.role}): ${f.detail}`);
    return 1;
  }
  console.log(`\nCI gate passed: ${hard.length} hard-tier finding(s), all present in baseline (no regressions).`);
  console.log(`${flat.filter((f) => f.tier === 'warn').length} warn-tier finding(s) (not gated; see report).`);
  return 0;
}

export function findingKey(f) {
  return `${f.type}::${f.route}::${f.role}::${f.dataState ?? 'fresh'}::${(f.control || f.text || f.detail || '').slice(0, 80)}`;
}

// Re-exported for merge-shard-results.mjs, which builds the same top-level
// report/baseline from several shard runs instead of one in-process run.
export {
  groupArea,
  writeMarkdown as writeMarkdownExport,
  classifyTier as classifyTierExport,
  ownerForRoute as ownerForRouteExport,
  walkRoutes,
  fileToRoute,
  requiredQueryParams,
  paramValueFor,
  APP_DIR,
  MOBILE_ROOT as MOBILE_ROOT_EXPORT,
  PLACEHOLDER_RE,
};

// Only run the CLI when this file is executed directly (`node
// half-done-audit.mjs ...`), not when merge-shard-results.mjs imports its
// exports.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
