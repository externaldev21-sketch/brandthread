#!/usr/bin/env node
/**
 * Static guard against the "thin dark bar flashing over the tab bar" class
 * of bug (see e2e/tab-bar-overlay-guard.spec.ts for the runtime version of
 * this same check).
 *
 * Root cause pattern this bans, in source: a `StyleSheet.create` (or inline
 * style object) entry that is BOTH —
 *   1. absolutely (or fixed-) positioned, AND
 *   2. under 40 logical points tall (an explicit `height` under 40, or a
 *      `top`/`bottom` pair that pins it to under 40pt), AND
 *   3. carries a literal partial-opacity value (`opacity: 0.NN`, neither 0
 *      nor 1) OR a `LinearGradient`/gradient-style `colors` array whose
 *      first or last stop is a *fully opaque* `rgba(...,1)`/`rgb(...)`/hex
 *      color sitting right at a scrollable content's edge (the exact bug
 *      class root-caused in this PR: `GRAD_DARK_FADE` going to alpha 1
 *      instead of fading all the way to transparent).
 *
 * This is a plain regex/heuristic scan (matches this repo's existing
 * script-based checks — see scripts/verify-*.js, scripts/audit/) rather
 * than a full AST lint rule: there's no ESLint custom-rule package set up
 * in this repo, and a source-text scan is enough to catch the literal
 * numeric-literal pattern this bug class always takes (a hand-written
 * height/opacity pair), while staying fast enough to run on every file in
 * CI with no build step.
 *
 * Usage: node scripts/lint/no-thin-partial-opacity-overlay.mjs [--fix-hint]
 * Exits 1 (and prints every offending file:line) if any match is found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components'];
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__', '__snapshots__']);
const FILE_EXT = /\.(tsx|ts)$/;

/** Walks a directory, yielding every .ts/.tsx file path. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (FILE_EXT.test(entry.name) && !entry.name.endsWith('.test.tsx') && !entry.name.endsWith('.test.ts')) {
      yield full;
    }
  }
}

/**
 * Finds every `{ ... }` style-object-shaped literal in the source and
 * returns each one's raw text plus its starting line number. Deliberately
 * naive brace matching (not a real parser) — good enough for the flat
 * object literals StyleSheet.create()/inline styles always use, and this
 * repo has no ESLint custom-rule/AST tooling to build on instead.
 */
function findStyleObjects(source) {
  const objects = [];
  const stack = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      stack.push(i);
    } else if (ch === '}' && stack.length) {
      const start = stack.pop();
      // Only consider objects that aren't huge (a style object, not a whole
      // component body that happens to contain one) — keeps false positives
      // (e.g. a JSX render function containing both a height and an unrelated
      // opacity prop far apart) low without needing real parsing.
      const text = source.slice(start, i + 1);
      // A leaf style object only — one with no further `key: {` nesting
      // inside it (a `StyleSheet.create({ a: {...}, b: {...} })` call's
      // OWN outer object also closes here and would otherwise get treated
      // as one giant "style object" spanning unrelated keys, e.g. picking
      // up an unrelated `width: '100%'` from a sibling key and wrongly
      // clearing the full-width-bar check for a small, unrelated icon).
      // `transform: [{ scale }]`'s array-of-objects is allowed through.
      const hasNestedObjectKey = /:\s*\{/.test(text.slice(1, -1));
      if (i - start < 600 && !hasNestedObjectKey) {
        objects.push({ text, start });
      }
    }
  }
  return objects;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const POSITION_RE = /\bposition\s*:\s*['"](absolute|fixed)['"]/;
const HEIGHT_RE = /\bheight\s*:\s*(\d+(?:\.\d+)?)\b/;
const TOP_RE = /\btop\s*:\s*(-?\d+(?:\.\d+)?)\b/;
const BOTTOM_RE = /\bbottom\s*:\s*(-?\d+(?:\.\d+)?)\b/;
const OPACITY_RE = /\bopacity\s*:\s*(\d*\.\d+|\d)\b/;
// Only a horizontal BAR (spans the width of its container) is the shape of
// this bug — a small decorative dot, watermark or 1x1 accessibility/tracking
// pixel is not, even though it's also thin and partially transparent. A bar
// either pins both `left`/`right` to 0 (or omits them, which is equivalent
// inside an `absoluteFill`-style object), sets `width: '100%'`, or has no
// numeric `width` at all alongside an absolute position (RN defaults an
// unset width on an absolutely-positioned view to its parent's full width
// only when `left`/`right` are both set — this scan treats "no `width` key"
// as the bar case and lets `isThin`'s `top`/`bottom` requirement narrow it).
const WIDTH_100_RE = /\bwidth\s*:\s*(['"]100%['"]|Dimensions\.get)/;
const LEFT_ZERO_RE = /\bleft\s*:\s*0\b/;
const RIGHT_ZERO_RE = /\bright\s*:\s*0\b/;
const NUMERIC_WIDTH_RE = /\bwidth\s*:\s*\d/;

function isFullWidthBar(styleText) {
  if (WIDTH_100_RE.test(styleText)) return true;
  if (LEFT_ZERO_RE.test(styleText) && RIGHT_ZERO_RE.test(styleText)) return true;
  // No explicit numeric width at all, positioned absolute with a height —
  // e.g. `StyleSheet.absoluteFill`-shaped or `{ position:'absolute', top,
  // bottom, height }` with width coming from the parent.
  if (!NUMERIC_WIDTH_RE.test(styleText) && !/\bwidth\s*:/.test(styleText)) return true;
  return false;
}

const MAX_THIN_HEIGHT = 40;

/**
 * Height under 40pt, derived either from an explicit `height` or from a
 * `top`+`bottom` pair that (given some container) pins the band to under
 * 40pt — the latter is how the tab-bar-region overlays in this app are
 * usually sized (e.g. `top: 0, bottom: SP.sm` inside a fixed-height row).
 * A bare `top`/`bottom` with no numeric literal for the other (e.g. a
 * themed constant) is not flagged — this is a heuristic scan, not a type
 * checker, and false negatives here are fine; the e2e guard catches the
 * runtime case regardless of how the height was expressed.
 */
function isThin(styleText) {
  const h = styleText.match(HEIGHT_RE);
  if (h && Number(h[1]) > 0 && Number(h[1]) < MAX_THIN_HEIGHT) return true;
  const top = styleText.match(TOP_RE);
  const bottom = styleText.match(BOTTOM_RE);
  if (top && bottom) {
    const span = Math.abs(Number(bottom[1]) - Number(top[1]));
    if (span > 0 && span < MAX_THIN_HEIGHT) return true;
  }
  return false;
}

function hasPartialOpacity(styleText) {
  const m = styleText.match(OPACITY_RE);
  if (!m) return false;
  const v = Number(m[1]);
  return v > 0 && v < 1;
}

function scanFile(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const findings = [];
  for (const obj of findStyleObjects(source)) {
    if (!POSITION_RE.test(obj.text)) continue;
    if (!isThin(obj.text)) continue;
    if (!hasPartialOpacity(obj.text)) continue;
    if (!isFullWidthBar(obj.text)) continue;
    findings.push({
      file: path.relative(MOBILE_ROOT, filePath),
      line: lineOf(source, obj.start),
      snippet: obj.text.replace(/\s+/g, ' ').slice(0, 140),
    });
  }
  findings.push(...scanOpaqueEdgeGradients(filePath, source));
  return findings;
}

// ─── Rule 2: opaque-edge scroll fade/mask overlays ─────────────────────────
// A `<LinearGradient>` (or similarly-named gradient component) whose
// `colors` array ends at a FULLY opaque stop (alpha 1, or a bare hex/rgb
// with no alpha) is the exact shape of the `GRAD_DARK_FADE` bug this PR
// fixes: a "fade" that actually goes to solid color at its own edge,
// painting a hard block over whatever content (most often a horizontally
// scrolling chip/pill row) it sits on top of. A real edge fade must reach
// full transparency (alpha 0) — never opaque — at both ends, and this app's
// house style is to not use one at all: the scroll container's own edge
// padding is what should let content clip naturally at the screen edge.
const GRADIENT_JSX_RE = /<\s*(?:[\w.]*LinearGradient|[\w.]*GradientOverlay)\b[^>]*colors\s*=\s*\{([^}]*)\}[^>]*\/?>/gs;
const OPAQUE_STOP_RE = /rgba?\([^)]*,\s*1\s*\)\s*$|#[0-9a-fA-F]{3,8}\s*$/;

function scanOpaqueEdgeGradients(filePath, source) {
  const findings = [];
  let match;
  GRADIENT_JSX_RE.lastIndex = 0;
  while ((match = GRADIENT_JSX_RE.exec(source))) {
    const colorsExpr = match[1].trim();
    // Only literal color-array expressions (not `theme.someGradient` etc.)
    // are checked — this stays a source-text heuristic, not a type checker.
    if (!colorsExpr.includes('[') && !colorsExpr.includes("'") && !colorsExpr.includes('"')) continue;
    const stops = colorsExpr.split(',').map((s) => s.trim()).filter(Boolean);
    const lastStop = stops[stops.length - 1] ?? '';
    const firstStop = stops[0] ?? '';
    if (OPAQUE_STOP_RE.test(lastStop) || OPAQUE_STOP_RE.test(firstStop)) {
      // Only a concern when it's also absolutely positioned (i.e. an
      // overlay sitting on top of something, not a background fill).
      const surroundingStyle = source.slice(Math.max(0, match.index - 400), match.index + match[0].length);
      if (POSITION_RE.test(surroundingStyle)) {
        findings.push({
          file: path.relative(MOBILE_ROOT, filePath),
          line: lineOf(source, match.index),
          snippet: match[0].replace(/\s+/g, ' ').slice(0, 140),
        });
      }
    }
  }
  return findings;
}

function main() {
  const allFindings = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(MOBILE_ROOT, dir);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const file of walk(full)) {
      allFindings.push(...scanFile(file));
    }
  }

  if (allFindings.length > 0) {
    console.error('no-thin-partial-opacity-overlay: found style object(s) that are');
    console.error('absolute/fixed-positioned, under 40pt tall, AND carry a literal');
    console.error('partial-opacity value — the exact shape of the "thin dark bar');
    console.error('flashing over the tab bar" bug class. Either size it to 40pt or');
    console.error('taller, make it fully transparent/opaque (opacity 0 or 1, driven');
    console.error('by real visibility state), or make it a real full-screen backdrop');
    console.error('tied to an actual open modal/sheet state.\n');
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}`);
      console.error(`    ${f.snippet}`);
    }
    process.exit(1);
  }

  console.log('no-thin-partial-opacity-overlay: no offending style objects found.');
}

main();
