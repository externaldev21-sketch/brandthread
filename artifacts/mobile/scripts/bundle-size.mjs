#!/usr/bin/env node
/**
 * Release-like JS bundle check for the native app.
 *
 *   pnpm run check:bundle-size              export, report, fail over budget
 *   pnpm run check:bundle-size -- --skip-export   re-read the last export
 *
 * Runs the same `expo export` a store build runs (production, minified,
 * Hermes bytecode) for iOS, then reports:
 *   - the size of the Hermes bundle the app loads at launch (and gzipped,
 *     roughly what an OTA update downloads),
 *   - which packages and app folders account for most of it, from the
 *     source map,
 * and exits non-zero when the bundle grows past BUDGET_BYTES, so a heavy
 * import shows up in review instead of in cold start time.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.bundle-check');
// Measured 17.1 MB on 2026-10-17, plus ~10% headroom. Raise it deliberately, in the
// same PR as the import that needs it.
const BUDGET_BYTES = 19 * 1024 * 1024;

const skipExport = process.argv.includes('--skip-export');

if (!skipExport) {
  rmSync(OUT, { recursive: true, force: true });
  const result = spawnSync(
    'pnpm',
    ['exec', 'expo', 'export', '--platform', 'ios', '--source-maps', '--output-dir', OUT],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: '' },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findFile(dir, test) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      const found = findFile(file, test);
      if (found) return found;
    } else if (test(name)) return file;
  }
  return null;
}

const bundle = findFile(OUT, (n) => /\.(hbc|js)$/.test(n) && !n.endsWith('.map'));
if (!bundle) throw new Error(`No iOS bundle found under ${OUT}`);
const map = findFile(OUT, (n) => n.endsWith('.map'));
const bytes = statSync(bundle).size;
const gzipped = gzipSync(readFileSync(bundle)).length;

/** Group source map entries by npm package (or app top-level folder). */
function groupKey(source) {
  const s = source.replace(/\\/g, '/');
  const nm = s.lastIndexOf('node_modules/');
  if (nm >= 0) {
    const rest = s.slice(nm + 'node_modules/'.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const rel = s.includes('/artifacts/mobile/') ? s.split('/artifacts/mobile/')[1] : s;
  return `app: ${rel.split('/')[0]}/`;
}

const groups = new Map();
if (map) {
  const { sources = [], sourcesContent = [] } = JSON.parse(readFileSync(map, 'utf8'));
  sources.forEach((source, i) => {
    const key = groupKey(source);
    groups.set(key, (groups.get(key) ?? 0) + (sourcesContent[i]?.length ?? 0));
  });
}
const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
const totalSource = [...groups.values()].reduce((a, b) => a + b, 0) || 1;

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const lines = [
  `Bundle: ${path.relative(ROOT, bundle)}`,
  `Size:   ${mb(bytes)} (gzip ${mb(gzipped)}), budget ${mb(BUDGET_BYTES)}`,
  '',
  'Largest contributors (share of bundled source):',
  ...top.map(([key, size]) => `  ${((size / totalSource) * 100).toFixed(1).padStart(5)}%  ${mb(size).padStart(9)}  ${key}`),
];
console.log(lines.join('\n'));
writeFileSync(path.join(OUT, 'report.txt'), `${lines.join('\n')}\n`);

if (bytes > BUDGET_BYTES) {
  console.error(`\nThe iOS bundle is ${mb(bytes)}, over the ${mb(BUDGET_BYTES)} budget. Find the new heavy import above.`);
  process.exit(1);
}
