#!/usr/bin/env node
/**
 * Static guard against the "Maximum update depth exceeded" infinite-render-
 * loop bug class root-caused in app/boost.tsx: a `useEffect`/`useMemo`/
 * `useCallback` dependency array entry that is a NEW array/object reference
 * every single render, so the hook's dependency check never stabilizes.
 *
 * Two concrete shapes, both banned:
 *
 *  1. A literal directly inside a dependency array, e.g. `}, [x, []])` or
 *     `}, [{}])` or `}, [new Map()])` — always a fresh reference every
 *     render, by construction.
 *
 *  2. A local `const name = <expr> ? <expr> : []` (or `?? []`/`|| []`, or
 *     the `{}` equivalents) computed inline during render — not inside a
 *     useMemo/useCallback/useState initializer, not module-level — whose
 *     `name` is later used as a dependency of a useEffect/useMemo/
 *     useCallback in the same file. The boost.tsx bug was exactly this:
 *     `const previewTargets = cond ? PREVIEW_BOOST_TARGETS : [];` followed
 *     by `useEffect(() => { ...setState(previewTargets)... },
 *     [inSellerPreview, previewTargets])` — previewTargets was a brand-new
 *     `[]` every render whenever `cond` was false, so the effect fired
 *     every render, called setState, which re-rendered, which fired the
 *     effect again — infinite loop, surfaced to the user as a red
 *     "Maximum update depth exceeded" error toast.
 *
 * Fix for either shape: hoist the empty/default value to a module-level
 * `const EMPTY_X = [];` (or `{}`) so every branch of the conditional
 * returns the SAME reference across renders, or wrap the computed value in
 * `useMemo` with the correct dependencies.
 *
 * This is a plain regex/heuristic scan (matches this repo's existing
 * script-based checks — see scripts/verify-*.js, scripts/audit/,
 * scripts/lint/no-thin-partial-opacity-overlay.mjs) rather than a full AST
 * lint rule: there's no ESLint custom-rule package set up in this repo.
 * False negatives are expected and fine (a determined enough pattern can
 * dodge a source-text scan); the goal is catching the common, literal shape
 * this bug always takes, fast enough to run on every file in `pnpm test`.
 *
 * Usage: node scripts/lint/no-unstable-effect-deps.mjs
 * Exits 1 (and prints every offending file:line) if any match is found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'hooks', 'contexts', 'lib', 'services'];
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__', '__snapshots__']);
const FILE_EXT = /\.(tsx|ts)$/;

/** Walks a directory, yielding every .ts/.tsx file path (skipping tests). */
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

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

// ─── Rule 1: a literal directly inside a dependency array ─────────────────
// `}, [` … `[]` / `{}` / `new X(` … `])` — matches useEffect/useMemo/
// useCallback's closing `}, [deps])` shape used throughout this codebase.
const DEP_ARRAY_RE = /\},\s*\[([^\]]*)\]\)/g;
const INLINE_LITERAL_IN_DEPS_RE = /(^|[,[]\s*)(\[\]|\{\}|new\s+[A-Z]\w*\s*\()/;

function scanInlineLiteralDeps(filePath, source) {
  const findings = [];
  let match;
  DEP_ARRAY_RE.lastIndex = 0;
  while ((match = DEP_ARRAY_RE.exec(source))) {
    const depsStr = match[1];
    if (INLINE_LITERAL_IN_DEPS_RE.test(depsStr)) {
      findings.push({
        file: path.relative(MOBILE_ROOT, filePath),
        line: lineOf(source, match.index),
        snippet: match[0].replace(/\s+/g, ' ').slice(0, 140),
        reason: 'a literal ([], {}, or new X(...)) sits directly inside a dependency array — always a fresh reference every render',
      });
    }
  }
  return findings;
}

// ─── Rule 2: a render-computed local whose fallback is a fresh [] / {},   ──
// later used as a dependency elsewhere in the same file. ───────────────────
// Matches `const name = <cond> ? <a> : []`, `const name = <expr> ?? []`,
// `const name = <expr> || []` and the `{}` equivalents, on one line, at
// any indentation — deliberately not restricted to top-level-of-component
// indentation, since a false positive here (an instance that's actually
// safely scoped inside a useMemo/useCallback body and never escapes) is
// cheap to dismiss by inspection, while a false negative defeats the point.
const UNSTABLE_DECL_RE = /^\s*const\s+([a-zA-Z_$][\w$]*)\s*=\s*.*(\?\s*.*:\s*(\[\]|\{\})|(\|\||\?\?)\s*(\[\]|\{\}))\s*;?\s*$/;

function scanRenderComputedFallback(filePath, source) {
  const findings = [];
  const lines = source.split('\n');
  const declaredAt = new Map(); // name -> 1-based line number

  lines.forEach((line, i) => {
    const m = UNSTABLE_DECL_RE.exec(line);
    if (m) declaredAt.set(m[1], i + 1);
  });
  if (declaredAt.size === 0) return findings;

  let match;
  DEP_ARRAY_RE.lastIndex = 0;
  while ((match = DEP_ARRAY_RE.exec(source))) {
    const deps = match[1].split(',').map((d) => d.trim()).filter(Boolean);
    for (const dep of deps) {
      if (declaredAt.has(dep)) {
        findings.push({
          file: path.relative(MOBILE_ROOT, filePath),
          line: declaredAt.get(dep),
          snippet: `const ${dep} = … ? … : [] / ?? [] / || []  (used as a dependency at line ${lineOf(source, match.index)})`,
          reason: `"${dep}" falls back to a fresh [] or {} computed during render, then feeds a dependency array — the exact app/boost.tsx bug shape`,
        });
      }
    }
  }
  return findings;
}

function scanFile(filePath) {
  const source = readFileSync(filePath, 'utf8');
  return [...scanInlineLiteralDeps(filePath, source), ...scanRenderComputedFallback(filePath, source)];
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
    console.error('no-unstable-effect-deps: found dependency array entries that are a');
    console.error('fresh array/object reference every render — the "Maximum update depth');
    console.error('exceeded" infinite-loop bug class root-caused in app/boost.tsx. Hoist');
    console.error('the empty/default value to a module-level `const EMPTY_X = [];` (or');
    console.error('`{}`) so every branch returns the SAME reference, or wrap the computed');
    console.error('value in useMemo with the correct dependencies.\n');
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}`);
      console.error(`    ${f.snippet}`);
      console.error(`    → ${f.reason}`);
    }
    process.exit(1);
  }

  console.log('no-unstable-effect-deps: no unstable dependency-array references found.');
}

main();
