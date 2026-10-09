#!/usr/bin/env node
/**
 * Corner-radius before/after proof, at 393x852 on the store-screenshots demo
 * harness (signed-in demo accounts, fake API, frozen clock).
 *
 *   node scripts/radius-before-after-screenshots.mjs capture <buildDir> <outDir>
 *       Serves an exported web build (see harness.buildPreviewWeb), opens each
 *       route in SCREENS, and writes <id>.png plus <id>.dom.json (every
 *       element's box and paint-relevant computed style).
 *
 *   node scripts/radius-before-after-screenshots.mjs compare <beforeDir> <afterDir> <outDir> [before2Dir]
 *       For every route captured in both: diffs the two DOM snapshots (only
 *       border-*-radius may differ; anything else is reported) and the two
 *       screenshots (every changed pixel must fall inside a corner region of
 *       an element whose radius changed, plus that element's shadow reach,
 *       or inside a backdrop-blur surface — the tab bars — where the blur
 *       spreads what sits behind it). `before2Dir` is a second capture of the
 *       BEFORE build: pixels that differ between the two BEFORE captures are
 *       animation/shimmer noise and are masked, and a route whose DOM differs
 *       between them is reported as unstable instead of proven.
 *       Writes <id>.before.png / .after.png / .diff.png and report.json.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const VIEWPORT = { width: 393, height: 852 };
const DEVICE = {
  viewport: VIEWPORT,
  scale: 1,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/** id, role, path — routes that render changed controls in the demo data. */
export const SCREENS = [
  ['buyer-feed', 'buyer', '/(buyer)'],
  ['buyer-discover', 'buyer', '/discover'],
  ['buyer-cart', 'buyer', '/cart'],
  ['buyer-checkout', 'buyer', '/buyer-checkout?source=cart'],
  ['buyer-inbox', 'buyer', '/(buyer)/inbox'],
  ['buyer-orders', 'buyer', '/(buyer)/orders'],
  ['buyer-profile', 'buyer', '/profile'],
  ['buyer-edit-profile', 'buyer', '/(buyer)/edit-profile'],
  ['buyer-friends', 'buyer', '/(buyer)/friends'],
  ['buyer-saved', 'buyer', '/buyer-saved'],
  ['buyer-archive', 'buyer', '/buyer-archive'],
  ['buyer-drops', 'buyer', '/buyer-drops'],
  ['buyer-live', 'buyer', '/live-feed'],
  ['buyer-activity', 'buyer', '/activity-center'],
  ['buyer-close-friends', 'buyer', '/buyer-close-friends'],
  ['buyer-story-create', 'buyer', '/buyer-story-create'],
  ['buyer-invite', 'buyer', '/buyer-invite'],
  ['buyer-qr-code', 'buyer', '/buyer-qr-code'],
  ['buyer-account-center', 'buyer', '/buyer-account-center'],
  ['shopping-preferences', 'buyer', '/shopping-preferences'],
  ['sign-in', 'buyer', '/sign-in'],
  ['onboarding', 'buyer', '/onboarding'],
  ['forgot-password', 'buyer', '/forgot-password'],
  ['help', 'buyer', '/help'],
  ['share-profile', 'buyer', '/share-profile'],
  ['seller-dashboard', 'seller', '/(tabs)'],
  ['seller-products', 'seller', '/(tabs)/products'],
  ['seller-orders', 'seller', '/(tabs)/orders'],
  ['seller-studio', 'seller', '/(tabs)/studio'],
  ['seller-more', 'seller', '/(tabs)/more'],
  ['seller-marketing', 'seller', '/(tabs)/marketing'],
  ['seller-following', 'seller', '/(tabs)/following'],
  ['seller-inbox', 'seller', '/seller-inbox'],
  ['seller-content', 'seller', '/content'],
  ['seller-create-post', 'seller', '/create-post'],
  ['seller-add-product', 'seller', '/add-product'],
  ['seller-store-editor', 'seller', '/store-editor'],
  ['seller-store-builder', 'seller', '/store-builder'],
  ['seller-store-generate', 'seller', '/store-generate'],
  ['seller-design', 'seller', '/design'],
  ['seller-design-canvas', 'seller', '/design-canvas'],
  ['seller-customers', 'seller', '/customers'],
  ['seller-shipping', 'seller', '/shipping'],
  ['seller-team', 'seller', '/team'],
  ['seller-payments', 'seller', '/payments'],
  ['seller-brand', 'seller', '/brand'],
  ['seller-locations', 'seller', '/locations'],
  ['seller-go-live', 'seller', '/seller-go-live'],
  ['seller-drop-create', 'seller', '/seller-drop-create'],
  ['seller-live', 'seller', '/seller-live'],
  ['seller-analytics-sales', 'seller', '/analytics-sales'],
  ['seller-settings', 'seller', '/seller-settings'],
  ['manufacturer-hub', 'seller', '/manufacturer-hub'],
  ['manufacturer-compare', 'seller', '/manufacturer-compare'],
  ['rfq-list', 'seller', '/rfq-list'],
  ['rfq-post', 'seller', '/rfq-post'],
  ['production-detail', 'seller', '/production-detail'],
  ['tech-pack', 'seller', '/tech-pack-generator'],
  ['thread-cash', 'seller', '/thread-cash'],
  ['subscription', 'seller', '/subscription'],
];

const STYLE_PROPS = [
  'display', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-style',
  'background-color', 'background-image', 'box-shadow', 'opacity', 'color', 'font-family', 'font-size', 'font-weight',
  'line-height', 'letter-spacing', 'transform', 'filter', 'backdrop-filter', 'z-index', 'overflow-x', 'overflow-y',
  'clip-path', 'mask-image', 'flex-direction', 'flex-grow', 'flex-shrink', 'justify-content', 'align-items', 'gap',
  'visibility', 'text-align',
];
const RADIUS_PROPS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];

/** Runs in the page: one record per element, in document order. */
function snapshotDom({ styleProps, radiusProps }) {
  const out = [];
  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const style = {};
    for (const p of styleProps) style[p] = cs.getPropertyValue(p);
    const radius = {};
    for (const p of radiusProps) radius[p] = cs.getPropertyValue(p);
    out.push({
      tag: el.tagName.toLowerCase(),
      testId: el.getAttribute('data-testid') || '',
      rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100),
      style,
      radius,
    });
  }
  return out;
}


/** Runs in the page: text that does not fit its box (truncated, clipped, or overflowing its parent). */
function scanTextFit() {
  const out = [];
  const vw = document.documentElement.clientWidth;
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = `${el.tagName.toLowerCase()}:"${own.slice(0, 28)}"`;
    const reasons = [];
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') reasons.push(`scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) reasons.push('ellipsis-truncated');
    const p = el.parentElement;
    if (p && p !== document.body) {
      const pr = p.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.right > pr.right + 1) reasons.push(`overflows parent horizontally (${Math.round(r.left - pr.left)}/${Math.round(r.right - pr.right)})`);
    }
    if (r.right > vw + 1 && r.left < vw) reasons.push('cut off at the screen edge');
    if (reasons.length) out.push({ el: label, rect: [r.x, r.y, r.width, r.height].map(Math.round), reasons });
  }
  return out;
}

async function capture(buildDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(path.resolve(buildDir));
  try {
    for (const role of ['buyer', 'seller']) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role, origin, images });
      for (const [id, screenRole, target] of SCREENS) {
        if (screenRole !== role) continue;
        if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) continue;
        try {
          // Some routes bounce back to "/" when the demo session races the redirect: retry until we are on the route.
          const expected = target.replace(/\?.*$/, '').replace(/\/\([^/]+\)/g, '');
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await openScreen(page, activity, origin, role, target);
            await waitForQuietNetwork(activity, 700, 8000);
            await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 1200));
            const here = new URL(page.url()).pathname;
            if (expected === '' || expected === '/' || here === expected) break;
            console.log(`  retry ${id}: landed on ${here}, wanted ${expected}`);
          }
          await page.screenshot({ path: path.join(outDir, `${id}.png`) });
          const dom = await page.evaluate(snapshotDom, { styleProps: STYLE_PROPS, radiusProps: RADIUS_PROPS });
          writeFileSync(path.join(outDir, `${id}.dom.json`), JSON.stringify(dom));
          writeFileSync(path.join(outDir, `${id}.fit.json`), JSON.stringify(await page.evaluate(scanTextFit)));
          console.log(`captured ${id} (${dom.length} elements)`);
        } catch (error) {
          console.log(`FAILED ${id}: ${String(error?.message ?? error).split('\n')[0]}`);
        }
      }
      await context.close();
    }
  } finally {
    close();
    await browser.close();
  }
}

const px = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};
const firstRadius = (r) => RADIUS_PROPS.map((p) => px(r[p]));
/** Reach of an element's box-shadow beyond its box (max over shadows). */
function shadowReach(value) {
  if (!value || value === 'none') return 0;
  let reach = 0;
  for (const part of value.split(/,(?![^(]*\))/)) {
    const nums = (part.replace(/rgba?\([^)]*\)/g, '').match(/-?\d+(\.\d+)?px/g) ?? []).map(px);
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    reach = Math.max(reach, Math.abs(x) + Math.abs(y) + blur + Math.max(spread, 0));
  }
  return reach;
}

/** Corner regions (+ shadow reach) of every element whose radius changed. */
function changedRadiusRegions(before, after) {
  const regions = [];
  const styleDiffs = [];
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a.tag !== b.tag) { styleDiffs.push(`#${i} tag ${a.tag} -> ${b.tag}`); continue; }
    if (a.rect.join() !== b.rect.join()) styleDiffs.push(`#${i} <${a.tag} ${a.testId}> rect ${a.rect} -> ${b.rect}`);
    for (const p of Object.keys(a.style)) {
      // each capture is served from its own random port
      const same = (v) => v.replace(/127\.0\.0\.1:\d+/g, 'HOST');
      if (same(a.style[p]) !== same(b.style[p])) styleDiffs.push(`#${i} <${a.tag} ${a.testId}> ${p}: ${a.style[p]} -> ${b.style[p]}`);
    }
    const ra = firstRadius(a.radius);
    const rb = firstRadius(b.radius);
    if (ra.join() !== rb.join()) {
      const [x, y, w, h] = b.rect;
      const reach = shadowReach(b.style['box-shadow']) + 2;
      regions.push({ i, tag: a.tag, testId: a.testId, x, y, w, h, ra, rb, reach });
    }
  }
  if (before.length !== after.length) styleDiffs.push(`element count ${before.length} -> ${after.length}`);
  const blurRects = after
    .filter((e) => e.style['backdrop-filter'] && e.style['backdrop-filter'] !== 'none')
    .map((e) => ({ x: e.rect[0] - 2, y: e.rect[1] - 2, w: e.rect[2] + 4, h: e.rect[3] + 4 }));
  return { regions, styleDiffs, blurRects };
}

function inRegion(px_, py_, g) {
  // corner boxes: size = max(old, new radius) clamped to half the box, plus AA + shadow reach
  const corners = [[0, 0, 0], [1, g.w, 0], [2, g.w, g.h], [3, 0, g.h]];
  for (const [k, cx, cy] of corners) {
    const size = Math.min(Math.max(g.ra[k], g.rb[k]), g.w / 2, g.h / 2) + 2 + g.reach;
    const ox = g.x + cx;
    const oy = g.y + cy;
    const left = cx === 0 ? ox - g.reach - 2 : ox - size;
    const right = cx === 0 ? ox + size : ox + g.reach + 2;
    const top = cy === 0 ? oy - g.reach - 2 : oy - size;
    const bottom = cy === 0 ? oy + size : oy + g.reach + 2;
    if (px_ >= left && px_ <= right && py_ >= top && py_ <= bottom) return true;
  }
  return false;
}

/** Runs in the page: diffs the pngs, classifies each changed pixel, returns counts + a diff image. */
async function diffInPage({ pngA, pngB, pngN, regions, blurRects, fnSrc }) {
  const inRegion = new Function(`return ${fnSrc}`)();
  const load = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
  const [a, b] = await Promise.all([load(pngA), load(pngB)]);
  const n = pngN ? await load(pngN) : null;
  const c = new OffscreenCanvas(a.width, a.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const read = (bitmap) => {
    ctx.clearRect(0, 0, a.width, a.height);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, a.width, a.height).data;
  };
  const da = read(a);
  const db = read(b);
  const dn = n ? read(n) : null;
  const W = a.width;
  const H = a.height;
  const differs = (p, q, i) => Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 0;
  // noise = pixels that differ between two captures of the same (BEFORE) build, grown by 1px
  const noise = new Uint8Array(W * H);
  if (dn) {
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      if (!differs(da, dn, (y * W + x) * 4)) continue;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const yy = y + dy; const xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W) noise[yy * W + xx] = 1;
      }
    }
  }
  const out = ctx.createImageData(W, H);
  let changed = 0; let inCorner = 0; let inBlur = 0; let noisy = 0; let outside = 0;
  const outsideSample = [];
  const box = [W, H, 0, 0];
  let maxDelta = 0; let strong = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const v = 255 - (255 - (db[i] + db[i + 1] + db[i + 2]) / 3) * 0.25; // faded "after" backdrop
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255;
      if (!differs(da, db, i)) continue;
      changed += 1;
      if (noise[y * W + x]) { noisy += 1; out.data[i] = 120; out.data[i + 1] = 120; out.data[i + 2] = 255; continue; } // blue = animation noise
      if (regions.some((g) => inRegion(x, y, g))) { inCorner += 1; out.data[i] = 200; out.data[i + 1] = 30; out.data[i + 2] = 30; continue; } // red = corner
      if (blurRects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) { inBlur += 1; out.data[i] = 230; out.data[i + 1] = 140; out.data[i + 2] = 0; continue; } // orange = behind tab-bar blur
      const dlt = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      maxDelta = Math.max(maxDelta, dlt); if (dlt > 24) strong += 1;
      outside += 1; if (outsideSample.length < 8) outsideSample.push([x, y]);
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 255; // magenta = unexplained
    }
  }
  ctx.putImageData(out, 0, 0);
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { width: W, height: H, changed, inCorner, inBlur, noisy, outside, outsideSample, unexplainedBox: box, maxDelta, strong, diffPng: btoa(bin) };
}

async function compare(beforeDir, afterDir, outDir, before2Dir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const has = (dir, id) => existsSync(path.join(dir, `${id}.dom.json`));
  const ids = readdirSync(beforeDir).filter((f) => f.endsWith('.dom.json')).map((f) => f.replace('.dom.json', ''))
    .filter((id) => has(afterDir, id));
  const read = (dir, id) => JSON.parse(readFileSync(path.join(dir, `${id}.dom.json`), 'utf8'));
  const png = (dir, id) => readFileSync(path.join(dir, `${id}.png`)).toString('base64');
  const report = [];
  for (const id of ids) {
    const before = read(beforeDir, id);
    const after = read(afterDir, id);
    const { regions, styleDiffs, blurRects } = changedRadiusRegions(before, after);
    // Is the BEFORE build itself stable on this route? (same DOM twice, ignoring animated values)
    let unstable = false;
    let pngN = null;
    if (before2Dir && has(before2Dir, id)) {
      const again = changedRadiusRegions(before, read(before2Dir, id));
      unstable = again.styleDiffs.some((d) => !/ (opacity|transform):| rect /.test(d)) || again.styleDiffs.some((d) => /element count/.test(d));
      pngN = png(before2Dir, id);
    }
    const result = await page.evaluate(diffInPage, { pngA: png(beforeDir, id), pngB: png(afterDir, id), pngN, regions, blurRects, fnSrc: inRegion.toString() });
    writeFileSync(path.join(outDir, `${id}.diff.png`), Buffer.from(result.diffPng, 'base64'));
    copyFileSync(path.join(beforeDir, `${id}.png`), path.join(outDir, `${id}.before.png`));
    copyFileSync(path.join(afterDir, `${id}.png`), path.join(outDir, `${id}.after.png`));
    const fitOf = (dir) => (existsSync(path.join(dir, `${id}.fit.json`)) ? JSON.parse(readFileSync(path.join(dir, `${id}.fit.json`), 'utf8')) : []);
    const key = (f) => `${f.el}|${f.reasons.join(';')}`;
    const fitBefore = fitOf(beforeDir);
    const fitAfter = fitOf(afterDir);
    const beforeKeys = new Set(fitBefore.map(key));
    const newFit = fitAfter.filter((f) => !beforeKeys.has(key(f)));
    const row = {
      id,
      textFitFindingsBefore: fitBefore.length,
      textFitFindingsAfter: fitAfter.length,
      textFitFindingsIntroduced: newFit,
      textFitFindingsAfterList: fitAfter,
      size: `${result.width}x${result.height}`,
      radiusChangedElements: regions.length,
      changedPixels: result.changed,
      inCornerRegions: result.inCorner,
      behindTabBarBlur: result.inBlur,
      animationNoise: result.noisy,
      unexplainedPixels: result.outside,
      nonRadiusDomDiffs: styleDiffs.length,
      nonRadiusDomDiffSample: styleDiffs.slice(0, 4),
      beforeBuildUnstable: unstable,
      unexplainedSample: result.outsideSample,
      unexplainedBox: result.outside ? result.unexplainedBox : null,
      unexplainedMaxChannelDelta: result.outside ? result.maxDelta : 0,
      unexplainedPixelsOver24: result.strong,
    };
    report.push(row);
    console.log(`${id}: ${regions.length} radius changes | ${result.changed}px changed = ${result.inCorner} corner + ${result.inBlur} blur + ${result.noisy} noise + ${result.outside} unexplained | ${styleDiffs.length} non-radius DOM diffs | text-fit ${fitBefore.length} -> ${fitAfter.length} (${newFit.length} new)${unstable ? ' | UNSTABLE' : ''}`);
  }
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

const [mode, a, b, c, d] = process.argv.slice(2);
if (mode === 'capture') await capture(a, b);
else if (mode === 'compare') await compare(a, b, c, d);
else if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('usage: capture <buildDir> <outDir> | compare <beforeDir> <afterDir> <outDir>');
  process.exit(1);
}
