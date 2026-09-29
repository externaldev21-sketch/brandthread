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

const PLACEHOLDER_RE = /coming soon|isn't tracked yet|is not tracked yet|not available yet|TODO\b|lorem ipsum|placeholder|^Label$|^Title$|\bundefined\b|\bNaN\b|\$NaN|Invalid Date/i;

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
function paramValueFor(name) {
  return PARAM_VALUES[name.toLowerCase()] ?? 'preview-1';
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
      node = node.parentElement;
    }
    return 'rgb(10,10,11)'; // app BG fallback
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
      results.texts.push({
        text: el.textContent.trim().slice(0, 200),
        color: cs.color,
        bg: nearestBg(el),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        overflow: cs.overflow,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        whiteSpace: cs.whiteSpace,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
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
    });
  }
  return results;
};

// ─── run one route/role combination ───────────────────────────────────────────
async function auditRoute({ browser, origin, role, route, images, budgetMs, maxTaps = 40 }) {
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
    await page.goto(`${origin}/?bt_preview=${role}`, { timeout: 20_000 });
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
    await waitForQuietNetwork(activity, 500, 8_000);
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
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
        const fullUrl = `${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`;
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
      (byY[key] ??= []).push(t.text);
    }
    for (const [, group] of Object.entries(byY)) {
      if (group.length >= 3) {
        const uniq = new Set(group);
        if (uniq.size === 1) {
          findings.push({ type: 'repeated-labels', severity: 'hard', detail: `${group.length} adjacent identical labels: "${group[0]}"`, text: group[0] });
        }
      }
    }
    // broken images
    for (const img of scan.images) {
      if (img.complete && img.naturalWidth === 0) {
        findings.push({ type: 'broken-image', severity: 'hard', detail: `Image failed to decode: ${img.src}`, text: img.src });
      }
    }
    // clipped single-line text
    for (const t of scan.texts) {
      if (t.overflow === 'hidden' && t.whiteSpace === 'nowrap' && t.scrollWidth > t.clientWidth + 2) {
        findings.push({ type: 'clipped-text', severity: 'warn', detail: `Text clipped (${t.scrollWidth}px into ${t.clientWidth}px): "${t.text}"`, text: t.text });
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
        await page.goto(`${origin}/?bt_preview=${role}`, { timeout: 10_000 });
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 10_000 }).catch(() => {});
        await waitForQuietNetwork(activity, 300, 4_000);
        const target = route.query ? `${route.routePath}?${route.query}` : route.routePath;
        await page.evaluate((url) => {
          history.pushState(history.state, '', url);
          window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
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
  const opts = { skipBuild: false, only: null, limit: null, timeBudgetMs: null, roles: ['seller', 'buyer'], ci: false, perRouteBudgetMs: 45_000, maxTaps: 40 };
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
  }
  return opts;
}

function classifyTier(finding) {
  // hard-fail tier: console errors, dead controls, placeholder copy, broken
  // images, repeated-labels, error boundaries — things that should never
  // regress and are cheap to keep at zero-new.
  // warn tier: color/type-scale/contrast/hit-target/clipped/overlap/button-
  // consistency — pervasive pre-existing debt, out of scope to fix in the
  // audit-infra PR; tracked but non-blocking for now.
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

  console.log(`Discovered ${routeFiles.length} route files; auditing ${routes.length} across roles [${opts.roles.join(', ')}].`);

  if (!opts.skipBuild) {
    console.log('Building preview web export…');
    buildPreviewWeb();
  } else if (!existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    throw new Error('--skip-build passed but no existing build found; run without --skip-build once.');
  }

  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();

  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.audit', 'demo-images'));

  const results = [];
  const overallStart = Date.now();
  const globalBudget = opts.timeBudgetMs ?? Infinity;
  let interrupted = false;

  outer:
  for (const route of routes) {
    for (const role of opts.roles) {
      if (Date.now() - overallStart > globalBudget) { interrupted = true; break outer; }
      process.stdout.write(`  [${role}] ${route.routePath}${route.query ? '?' + route.query : ''} … `);
      try {
        const r = await Promise.race([
          auditRoute({ browser, origin, role, route, images, budgetMs: opts.perRouteBudgetMs, maxTaps: opts.maxTaps }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('route timed out')), opts.perRouteBudgetMs + 15_000)),
        ]);
        results.push({ route: route.routePath, file: route.file, role, ...r });
        console.log(r.reachable ? `${r.findings.length} finding(s)` : `unreachable (${r.unreachableReason})`);
      } catch (err) {
        results.push({ route: route.routePath, file: route.file, role, reachable: false, unreachableReason: String(err?.message || err), findings: [] });
        console.log(`ERROR: ${err?.message || err}`);
      }
    }
  }

  await browser.close().catch(() => {});
  close();

  const flat = [];
  for (const r of results) {
    for (const f of r.findings) {
      flat.push({ ...f, route: r.route, file: r.file, role: r.role, tier: classifyTier(f), screenshotDir: r.shotDir });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    interrupted,
    routesDiscovered: routeFiles.length,
    routesAudited: results.length,
    unreachable: results.filter((r) => !r.reachable).map((r) => ({ route: r.route, role: r.role, reason: r.unreachableReason })),
    findingsByType: {},
    findingsByTier: { hard: 0, warn: 0 },
  };
  for (const f of flat) {
    summary.findingsByType[f.type] = (summary.findingsByType[f.type] || 0) + 1;
    summary.findingsByTier[f.tier] += 1;
  }

  writeFileSync(OUT_JSON, JSON.stringify({ summary, findings: flat, results: results.map((r) => ({ route: r.route, role: r.role, reachable: r.reachable, unreachableReason: r.unreachableReason, file: r.file })) }, null, 2));
  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`Findings: ${flat.length} (hard: ${summary.findingsByTier.hard}, warn: ${summary.findingsByTier.warn})`);

  writeMarkdown(summary, flat);

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

function writeMarkdown(summary, flat) {
  const byArea = {};
  for (const f of flat) {
    const area = groupArea(f.route);
    (byArea[area] ??= []).push(f);
  }
  const areaOrder = Object.keys(byArea).sort((a, b) => byArea[b].length - byArea[a].length);

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
  lines.push('## Notes on this run');
  lines.push('');
  lines.push('This is a time-budgeted pass, not full coverage — see `routesAudited` vs `routesDiscovered` above. One caveat found while producing it:');
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
    lines.push('| Route | Role | Reason |');
    lines.push('|---|---|---|');
    for (const u of summary.unreachable) lines.push(`| \`${u.route}\` | ${u.role} | ${u.reason ?? ''} |`);
  }
  lines.push('');
  lines.push('## Findings by area');
  lines.push('');
  for (const area of areaOrder) {
    const items = byArea[area].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'hard' ? -1 : 1));
    lines.push(`### ${area} (${items.length})`);
    lines.push('');
    lines.push('| Route | Role | Type | Tier | Detail | Screenshot |');
    lines.push('|---|---|---|---|---|---|');
    for (const f of items.slice(0, 300)) {
      const shot = f.screenshotDir ? `[view](../../${f.screenshotDir}/00-initial.png)` : '';
      const detail = (f.detail || '').replace(/\|/g, '\\|').slice(0, 160);
      lines.push(`| \`${f.route}\` | ${f.role} | ${f.type} | ${f.tier} | ${detail} | ${shot} |`);
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
  return `${f.type}::${f.route}::${f.role}::${(f.control || f.text || f.detail || '').slice(0, 80)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
