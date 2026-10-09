#!/usr/bin/env node
/**
 * Codemod: collapse the app's ~51 corner radii onto four tokens
 * (constants/radii.ts `radius`: sm 8, md 12, lg 16, plus full for pills and
 * circles). BRANDTHREAD_DESIGN.md "Buttons" / "Surfaces".
 *
 *   node scripts/codemods/radii.mjs           rewrite in place
 *   node scripts/codemods/radii.mjs --check   report only
 *
 * Re-runnable and idempotent.
 *  - literal `borderRadius: N` (and the per-corner variants) for 5 ≤ N ≤ 40
 *    snap to 8 / 12 / 16 — unless the same style object makes it a circle
 *    or pill (N ≥ half its literal width or height), which stays as is
 *  - 0–4 stay (hairline tracks, dots, progress bars — shapes, not corners)
 *  - ≥ 999 stay (already "full")
 * Skips the seller tab bar / glow / Studio menu, Design Studio, and the
 * create-flow camera UI.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['app', 'components'];
export const TOKENS = [8, 12, 16];
export const EXCLUDE = [
  /^components\/tab-bar\//,
  /^components\/SellerGlobalTabBar\.tsx$/,
  /^components\/SellerStudioRadialMenu\.tsx$/,
  /^components\/StudioMenuHints\.tsx$/,
  /^app\/design-/,
  /^components\/design/,
  /^components\/create-post\//,
  /\.test\.tsx?$/,
];

export function snap(n) {
  if (n < 5 || n > 40) return n;
  let best = TOKENS[0];
  for (const t of TOKENS) if (Math.abs(t - n) < Math.abs(best - n) || (Math.abs(t - n) === Math.abs(best - n) && t < best)) best = t;
  return best;
}

const PROP = /\b(borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|borderTopStartRadius|borderTopEndRadius|borderBottomStartRadius|borderBottomEndRadius):\s*(\d+(?:\.\d+)?)(?![\d.]*\s*[*/+-])/g;

/** The `{ … }` object literal around index i (innermost, same line or nearby), or ''. */
function enclosingObject(src, i) {
  let depth = 0, start = -1;
  for (let j = i; j >= 0 && i - j < 1200; j--) {
    const c = src[j];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) { start = j; break; } depth--; }
  }
  if (start < 0) return '';
  depth = 0;
  for (let k = start; k < src.length && k - start < 2400; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  return '';
}

function isRoundShape(obj, n) {
  const num = (key) => {
    const m = obj.match(new RegExp(String.raw`\b${key}:\s*(\d+(?:\.\d+)?)\b(?!\s*[*/+-])`));
    return m ? Number(m[1]) : null;
  };
  const dims = [num('width'), num('height'), num('minHeight'), num('size')].filter((v) => v != null);
  return dims.some((d) => n >= d / 2 - 0.5);
}

/** Old lib/theme.ts RADIUS values, frozen here so circle detection survives the token remap. */
export const LEGACY_RADIUS = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32 };

export function transform(src) {
  let count = 0;
  // A RADIUS token that currently makes a circle/pill keeps its exact value
  // as a literal, so remapping the token to 8/12/16 can't square it off.
  src = src.replace(/\b(borderRadius|border(?:Top|Bottom)(?:Left|Right|Start|End)Radius):\s*RADIUS\.(xs|sm|md|lg|xl|xxl)\b/g, (all, prop, key, offset, whole) => {
    const n = LEGACY_RADIUS[key];
    return isRoundShape(enclosingObject(whole, offset), n) ? `${prop}: ${n}` : all;
  });
  const out = src.replace(PROP, (all, prop, raw, offset) => {
    const n = Number(raw);
    const next = snap(n);
    if (next === n) return all;
    if (isRoundShape(enclosingObject(src, offset), n)) return all;
    count++;
    return `${prop}: ${next}`;
  });
  return { out, count };
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
  let files = 0, total = 0;
  for (const dir of DIRS) for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXCLUDE.some((re) => re.test(rel))) continue;
    const src = readFileSync(file, 'utf8');
    const { out, count } = transform(src);
    if (!count) continue;
    files++; total += count;
    if (!check) writeFileSync(file, out);
  }
  console.log(`${check ? 'Would change' : 'Changed'} ${files} files: ${total} radii snapped to 8/12/16`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
