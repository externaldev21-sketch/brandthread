#!/usr/bin/env node
/**
 * Crispness lint ("Crisp everywhere: no blur on any screen").
 *
 * Flags the source patterns that make a screen, a line of text, a box edge or
 * an image look soft:
 *
 *   blur            BlurView, CSS backdrop-filter / filter: blur(), or a
 *                   non-zero `blurRadius` on an image
 *   glass           a translucent <Glass>/<GlassPanel> surface without `solid`
 *                   (glass is only for small floating controls over media)
 *   fadedText       a text colour with alpha < 1 (faded white) — use the
 *                   solid secondary colours (#C0C0C0, #8E8E93)
 *   hairline        a fractional border width (0.5, 0.33…) — use
 *                   StyleSheet.hairlineWidth, which is exactly one device pixel
 *   fractionalRadius a fractional corner radius
 *   fractionalFont  a fractional fontSize
 *   rnImage         Image imported from react-native (use expo-image /
 *                   CachedImage, which decode at the rendered size)
 *   smearShadow     a soft drop shadow (shadowRadius >= 6 or elevation >= 6)
 *   disabledOpacity a disabled state drawn by fading the control's opacity
 *                   (use a solid gray, e.g. #8E8E93 text on #1C1C1E)
 *   willChange      `willChange` on the web (keeps a layer — and its text —
 *                   rasterised after the animation ends)
 *
 * Two lists keep this honest:
 *   crisp-allowlist.json  permanent, intended exceptions, each with a reason
 *                         (the seller tab bar glass, floating controls over
 *                         photos/video). Shown in the PR so Dev can decide.
 *   crisp-baseline.json   per-file counts of what is still left to fix. A file
 *                         fails when it has MORE of a pattern than baseline +
 *                         allow-list, so nothing new slips in while the
 *                         baseline shrinks to zero.
 *
 *   node scripts/lint/crisp.mjs                    check
 *   node scripts/lint/crisp.mjs --report           print every remaining hit
 *   node scripts/lint/crisp.mjs --update-baseline  rewrite the baseline
 *
 * Run in CI through tests/crisp-lint.test.ts. The runtime half of the check
 * (what the browser actually paints) is scripts/crisp/crawl.mjs.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
export const BASELINE_PATH = path.join(__dirname, 'crisp-baseline.json');
export const ALLOWLIST_PATH = path.join(__dirname, 'crisp-allowlist.json');
const SCAN_DIRS = ['app', 'components', 'constants', 'contexts', 'hooks', 'lib'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__snapshots__']);
const SOURCE = /\.(tsx|ts)$/;
const TEST = /\.test\.(tsx|ts)$/;

export const RULES = [
  'blur', 'glass', 'fadedText', 'hairline', 'fractionalRadius', 'fractionalFont', 'rnImage', 'smearShadow', 'disabledOpacity', 'willChange',
];

/** Strips // and /* *\/ comments so prose about a pattern never counts as one. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/** Each hit: { rule, line, text }. */
export function scanHits(rawSource) {
  const source = stripComments(rawSource);
  const hits = [];
  const add = (rule, index) => {
    const line = source.slice(0, index).split('\n').length;
    hits.push({ rule, line, text: rawSource.split('\n')[line - 1].trim().slice(0, 160) });
  };
  const each = (re, rule, keep = () => true) => {
    for (const m of source.matchAll(re)) if (keep(m)) add(rule, m.index);
  };

  each(/<BlurView\b/g, 'blur');
  each(/\b(?:Webkit)?[Bb]ackdropFilter\s*:/g, 'blur');
  each(/backdrop-filter\s*:/g, 'blur');
  each(/\bfilter\s*:\s*[`'"][^`'"]*blur\(/g, 'blur');
  each(/\bblurRadius\s*=\s*\{([^}]*)\}/g, 'blur', (m) => m[1].trim() !== '0');
  each(/\bblurRadius\s*:\s*([^,}\n]+)/g, 'blur', (m) => m[1].trim() !== '0');

  each(/<(Glass)\b([^>]*?)\/?>/g, 'glass', (m) => !/\bsolid\b/.test(m[2]));

  each(/\bcolor\s*:\s*['"`]rgba\([^)]*,\s*(0?\.\d+)\s*\)['"`]/g, 'fadedText', (m) => Number(m[1]) > 0 && Number(m[1]) < 1);
  each(/\bcolor\s*:\s*['"`]#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})['"`]/g, 'fadedText', (m) => m[1].toUpperCase() !== 'FF' && m[1] !== '00');

  each(/\bborder(?:Top|Bottom|Left|Right|Start|End)?Width\s*:\s*(\d*\.\d+)/g, 'hairline', (m) => !Number.isInteger(Number(m[1])));
  each(/\bborder(?:TopLeft|TopRight|BottomLeft|BottomRight|TopStart|TopEnd|BottomStart|BottomEnd)?Radius\s*:\s*(\d*\.\d+)/g, 'fractionalRadius', (m) => !Number.isInteger(Number(m[1])));
  each(/\bfontSize\s*:\s*(\d*\.\d+)/g, 'fractionalFont', (m) => !Number.isInteger(Number(m[1])));

  // Every <Image> rendered in a file that takes Image from react-native
  // (Image.getSize / Image.prefetch alone are fine: nothing is painted).
  const rnImport = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g)]
    .some((m) => /(^|[\s,])Image(\s*,|\s*$)/.test(m[1]));
  if (rnImport) each(/<Image\b/g, 'rnImage');

  each(/\bshadowRadius\s*:\s*(\d+(?:\.\d+)?)/g, 'smearShadow', (m) => Number(m[1]) >= 6);
  each(/\belevation\s*:\s*(\d+)/g, 'smearShadow', (m) => Number(m[1]) >= 6);

  each(/\bdisabled\b[^\n;]{0,48}\bopacity\s*:/g, 'disabledOpacity');
  each(/\bopacity\s*:\s*[^,}\n]*\bdisabled\b/g, 'disabledOpacity');
  each(/\bopacity\s*:\s*[^,}\n]*\b(?:isDisabled|canSubmit|canSave|canSend|canContinue|valid|isValid)\b\s*\?/g, 'disabledOpacity');

  each(/\bwillChange\s*:/g, 'willChange');
  each(/will-change\s*:/g, 'willChange');
  return hits;
}

/** Counts per rule for one file's source. */
export function scanSource(source) {
  const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const hit of scanHits(source)) counts[hit.rule] += 1;
  return counts;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) yield full;
  }
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** { 'components/Foo.tsx': { blur: 1, ... } } for every file with a hit. */
export function scanTree(root = MOBILE_ROOT) {
  const result = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const counts = scanSource(readFileSync(file, 'utf8'));
      const nonZero = RULES.filter((rule) => counts[rule] > 0);
      if (nonZero.length) result[relative(root, file)] = Object.fromEntries(nonZero.map((rule) => [rule, counts[rule]]));
    }
  }
  return result;
}

/** Every hit in the tree, with file + line, for --report. */
export function reportTree(root = MOBILE_ROOT) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      for (const hit of scanHits(readFileSync(file, 'utf8'))) out.push({ file: relative(root, file), ...hit });
    }
  }
  return out;
}

export function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/** { file: { rule: { count, reason } } } */
export function readAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).files;
}

/** Every (file, rule) whose count exceeds baseline + allow-list. */
export function findViolations(current, baseline, allowlist = {}) {
  const violations = [];
  for (const [file, counts] of Object.entries(current)) {
    for (const rule of RULES) {
      const allowed = (baseline[file]?.[rule] ?? 0) + (allowlist[file]?.[rule]?.count ?? 0);
      if ((counts[rule] ?? 0) > allowed) violations.push({ file, rule, count: counts[rule], allowed });
    }
  }
  return violations;
}

/** Baseline = current minus the allow-list (never negative). */
export function baselineFrom(current, allowlist = {}) {
  const baseline = {};
  for (const file of Object.keys(current).sort()) {
    const entry = {};
    for (const rule of RULES) {
      const left = (current[file][rule] ?? 0) - (allowlist[file]?.[rule]?.count ?? 0);
      if (left > 0) entry[rule] = left;
    }
    if (Object.keys(entry).length) baseline[file] = entry;
  }
  return baseline;
}

export const HINT = {
  blur: 'no blur: use a solid fill (#1C1C1E for sheets/inputs, black elsewhere) or a solid dim backdrop',
  fadedText: 'use a solid secondary colour (#C0C0C0 / #8E8E93), not faded white',
  glass: 'pass `solid` (opaque #1C1C1E) — translucent glass is only for floating controls over media',
  hairline: 'use StyleSheet.hairlineWidth (or a whole-pixel width)',
  fractionalRadius: 'use a whole-pixel radius (constants/radii)',
  fractionalFont: 'use a whole-point size from the type scale',
  rnImage: "use CachedImage / expo-image instead of react-native's Image",
  smearShadow: 'drop the soft shadow; separate with a hairline or spacing',
  disabledOpacity: 'draw the disabled state with solid gray colors, not opacity',
  willChange: 'remove will-change; it keeps text rasterised on a layer',
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const current = scanTree();
  const allowlist = readAllowlist();
  if (process.argv.includes('--update-baseline')) {
    const baseline = baselineFrom(current, allowlist);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Crisp baseline written: ${Object.keys(baseline).length} files.`);
  } else if (process.argv.includes('--report')) {
    const only = process.argv.find((a) => a.startsWith('--rule='))?.slice(7);
    for (const hit of reportTree()) {
      if (!only || hit.rule === only) console.log(`${hit.file}:${hit.line}  [${hit.rule}]  ${hit.text}`);
    }
  } else {
    const violations = findViolations(current, readBaseline(), allowlist);
    for (const v of violations) console.error(`${v.file}: ${v.rule} ${v.count} (allowed ${v.allowed}) — ${HINT[v.rule]}`);
    if (violations.length) process.exit(1);
    const totals = Object.fromEntries(RULES.map((rule) => [rule, 0]));
    for (const counts of Object.values(readBaseline())) for (const [rule, n] of Object.entries(counts)) totals[rule] += n;
    console.log(`Crisp lint: nothing new. Left to fix: ${RULES.map((r) => `${r} ${totals[r]}`).join(', ')}.`);
  }
}
