#!/usr/bin/env node
/**
 * Codemod: collapse the app's ~35 literal font sizes onto the iOS type
 * scale (BRANDTHREAD_DESIGN.md "Type"; Apple HIG text styles) and remove
 * the tracked ALL-CAPS label look.
 *
 *   node scripts/codemods/type-scale.mjs           rewrite in place
 *   node scripts/codemods/type-scale.mjs --check   report only
 *
 * Re-runnable and idempotent (every output size is already on the scale).
 *
 *  - `fontSize: <literal>` → nearest step of SCALE (sizes ≥ 40 are display
 *    numerals / emoji glyphs and stay as they are)
 *  - `textTransform: 'uppercase'` removed (labels render as written)
 *  - positive `letterSpacing` above 0.2 removed (negative tightening on large
 *    titles stays — that is the iOS display style)
 *
 * Skips user-content typography (Design Studio canvas text, story/create
 * text tools, stickers) and the seller tab bar / Studio menu.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['app', 'components'];

/** iOS text styles: caption2 11 (badges only), caption 12, footnote 13, subhead 15, callout 16, body/headline 17, title3 20, title2 22, title1 28, largeTitle 34. */
export const SCALE = [11, 12, 13, 15, 16, 17, 20, 22, 28, 34];
export const DISPLAY_MIN = 40;

export const EXCLUDE = [
  /^components\/tab-bar\//,
  /^components\/SellerGlobalTabBar\.tsx$/,
  /^components\/SellerStudioRadialMenu\.tsx$/,
  /^components\/StudioMenuHints\.tsx$/,
  /^app\/design-/,
  /^components\/design/,
  /^components\/create-post\//,
  /^app\/(buyer-)?story-/,
  /^components\/(TextOverlayEditor|StoryMention[^/]*|ThreadShareSheet)\.tsx$/,
  /^components\/share-cards\//,
  /\.test\.tsx?$/,
];

/** Nearest scale step; ties go up (readability), 14 → 15. */
export function snap(size) {
  if (size >= DISPLAY_MIN) return size;
  let best = SCALE[0];
  for (const step of SCALE) {
    if (Math.abs(step - size) < Math.abs(best - size) || (Math.abs(step - size) === Math.abs(best - size) && step > best)) best = step;
  }
  return best;
}

const PROP_END = String.raw`(?=\s*[,}\n])`;

/** Pure: returns { out, sizes, caps, tracking } with counts of each change. */
export function transform(src) {
  let sizes = 0, caps = 0, tracking = 0;
  let out = src.replace(/(fontSize:\s*)(\d+(?:\.\d+)?)(?![\d.]*\s*[*/+-])/g, (all, pre, num) => {
    const next = snap(Number(num));
    if (next === Number(num)) return all;
    sizes++;
    return `${pre}${next}`;
  });

  const dropProp = (text, propRe, test) => {
    // Whole line holding only this property.
    text = text.replace(new RegExp(String.raw`^[ \t]*${propRe.source},?[ \t]*\r?\n`, 'gm'), (line) => {
      if (!test(line)) return line;
      return '';
    });
    // Inline, preceded by a comma.
    text = text.replace(new RegExp(String.raw`,\s*${propRe.source}${PROP_END}`, 'g'), (m) => (test(m) ? '' : m));
    // Inline, first in the object.
    text = text.replace(new RegExp(String.raw`${propRe.source}\s*,\s*`, 'g'), (m) => (test(m) ? '' : m));
    return text;
  };

  const before1 = out;
  out = dropProp(out, /textTransform:\s*['"]uppercase['"](?:\s+as\s+const)?/, () => true);
  caps = (before1.match(/textTransform:\s*['"]uppercase['"]/g) || []).length - (out.match(/textTransform:\s*['"]uppercase['"]/g) || []).length;

  const before2 = out;
  const wide = (m) => {
    const v = m.match(/letterSpacing:\s*(-?\d+(?:\.\d+)?)/);
    return !!v && Number(v[1]) > 0.2;
  };
  out = dropProp(out, /letterSpacing:\s*\d+(?:\.\d+)?/, wide);
  tracking = (before2.match(/letterSpacing:\s*\d/g) || []).length - (out.match(/letterSpacing:\s*\d/g) || []).length;

  return { out, sizes, caps, tracking };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const totals = { files: 0, sizes: 0, caps: 0, tracking: 0 };
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (EXCLUDE.some((re) => re.test(rel))) continue;
      const src = readFileSync(file, 'utf8');
      const { out, sizes, caps, tracking } = transform(src);
      if (out === src) continue;
      totals.files++; totals.sizes += sizes; totals.caps += caps; totals.tracking += tracking;
      if (!check) writeFileSync(file, out);
    }
  }
  console.log(`${check ? 'Would change' : 'Changed'} ${totals.files} files: ${totals.sizes} font sizes snapped, ${totals.caps} uppercase removed, ${totals.tracking} wide letterSpacing removed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
