/**
 * Lint: no `console.log` in shipped app source.
 *
 * Production native bundles already strip console.log/info/debug via
 * babel-plugin-transform-remove-console (babel.config.js), but web/preview
 * builds and dev keep them, so stray debug logging leaks there. Diagnostics
 * that matter go through lib/monitoring (`addMonitoringBreadcrumb` /
 * `reportError`) or a `__DEV__`-guarded `console.warn`/`console.info`.
 *
 * Scans app/, components/, lib/, services/, hooks/, contexts/ (test files
 * excluded; scripts/ and e2e/ are developer tooling and out of scope).
 * Comments are stripped first so prose about logging never trips it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['app', 'components', 'lib', 'services', 'hooks', 'contexts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

// `console.log(`, `console .log(`, `console\n  .log(` and `console['log']`.
const CONSOLE_LOG_RE = /\bconsole\s*(?:\.\s*log\b|\[\s*['"`]log['"`]\s*\])/;

describe('no console.log in app source', () => {
  it('has no console.log calls', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      const abs = path.join(ROOT, dir);
      try {
        statSync(abs);
      } catch {
        continue;
      }
      for (const file of walk(abs)) {
        if (CONSOLE_LOG_RE.test(stripComments(readFileSync(file, 'utf8')))) {
          offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
