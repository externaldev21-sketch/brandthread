#!/usr/bin/env node
/**
 * Design-foundation lint (BRANDTHREAD_DESIGN.md, Session 0).
 *
 * Flags the three "made by AI" tells in new code:
 *   feather      — importing Feather from @expo/vector-icons
 *                  (use `Icon` from components/ui/Icon instead)
 *   uppercase    — textTransform: 'uppercase' (labels are sentence case)
 *   letterSpacing — a positive letterSpacing above 0.2 (hierarchy comes
 *                  from size and weight, not tracking)
 *
 * Existing code is grandfathered per file in design-foundation-baseline.json
 * (restyle sessions shrink it). A file fails when it has MORE of a tell than
 * its baseline, so any new occurrence — in a new file or an old one — is
 * caught, with no dependence on git history.
 *
 *   node scripts/lint/design-foundation.mjs                   check
 *   node scripts/lint/design-foundation.mjs --update-baseline rewrite baseline
 *
 * Run in CI through tests/design-foundation-lint.test.ts.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
export const BASELINE_PATH = path.join(__dirname, 'design-foundation-baseline.json');
const SCAN_DIRS = ['app', 'components', 'constants', 'contexts', 'hooks', 'lib'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__snapshots__']);
const SOURCE = /\.(tsx|ts)$/;
const TEST = /\.test\.(tsx|ts)$/;

export const RULES = ['feather', 'uppercase', 'letterSpacing'];

/** Counts each tell in one file's source text. */
export function scanSource(source) {
  const counts = { feather: 0, uppercase: 0, letterSpacing: 0 };
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@expo\/vector-icons['"]/g)) {
    if (/\bFeather\b/.test(match[1])) counts.feather += 1;
  }
  counts.feather += (source.match(/from\s*['"]@expo\/vector-icons\/Feather['"]/g) ?? []).length;
  counts.uppercase += (source.match(/textTransform\s*:\s*['"]uppercase['"]/g) ?? []).length;
  for (const match of source.matchAll(/letterSpacing\s*:\s*(\d*\.?\d+)/g)) {
    if (Number(match[1]) > 0.2) counts.letterSpacing += 1;
  }
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

/** { 'components/Foo.tsx': { feather: 1, ... } } for every file with a tell. */
export function scanTree(root = MOBILE_ROOT) {
  const result = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const counts = scanSource(readFileSync(file, 'utf8'));
      if (RULES.some((rule) => counts[rule] > 0)) {
        result[path.relative(root, file).split(path.sep).join('/')] = Object.fromEntries(
          RULES.filter((rule) => counts[rule] > 0).map((rule) => [rule, counts[rule]]),
        );
      }
    }
  }
  return result;
}

export function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/** Every (file, rule) whose count exceeds the baseline. */
export function findViolations(current, baseline) {
  const violations = [];
  for (const [file, counts] of Object.entries(current)) {
    for (const rule of RULES) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if ((counts[rule] ?? 0) > allowed) violations.push({ file, rule, count: counts[rule], allowed });
    }
  }
  return violations;
}

const HINT = {
  feather: "import { Icon } from '@/components/ui/Icon' instead of Feather",
  uppercase: 'use sentence case text instead of textTransform: uppercase',
  letterSpacing: 'drop the tracking; use size/weight for hierarchy',
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const current = scanTree();
  if (process.argv.includes('--update-baseline')) {
    const sorted = Object.fromEntries(Object.keys(current).sort().map((file) => [file, current[file]]));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`Baseline written: ${Object.keys(sorted).length} files.`);
  } else {
    const violations = findViolations(current, readBaseline());
    for (const v of violations) console.error(`${v.file}: ${v.rule} ${v.count} (baseline ${v.allowed}) — ${HINT[v.rule]}`);
    if (violations.length) process.exit(1);
    console.log('Design foundation lint: no new Feather imports, uppercase labels or wide tracking.');
  }
}
