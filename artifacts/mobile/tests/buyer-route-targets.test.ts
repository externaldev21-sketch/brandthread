import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Zero-dead-ends guard for the buyer area: every static navigation target
 * (`router.push`, `router.replace`, the ThreadPull transition's `push`, and
 * `{ pathname: '...' }` object-form navigation) found in buyer-side screens
 * must resolve to a real expo-router file on disk.
 *
 * This is a best-effort static scan, not a full parser: it extracts the
 * literal/template-literal argument passed to a push/replace call, then
 * takes the static prefix before the first `?` (query string) or `${`
 * (interpolation), and checks that prefix resolves to a route file. Fully
 * dynamic paths with no static prefix (e.g. a bare `${var}`) can't be
 * checked this way and are skipped.
 */

const APP_DIR = resolve(__dirname, '..', 'app');

function listBuyerFiles(): string[] {
  const buyerGroupDir = resolve(APP_DIR, '(buyer)');
  const groupFiles = readdirSync(buyerGroupDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => resolve(buyerGroupDir, f));

  const rootBuyerFiles = readdirSync(APP_DIR)
    .filter((f) => f.startsWith('buyer-') && f.endsWith('.tsx'))
    .map((f) => resolve(APP_DIR, f));

  return [...groupFiles, ...rootBuyerFiles];
}

function routeExists(rawPath: string): boolean | null {
  const cutIndex = Math.min(
    ...[rawPath.indexOf('?'), rawPath.indexOf('${')].filter((i) => i >= 0),
  );
  const staticPart = Number.isFinite(cutIndex) ? rawPath.slice(0, cutIndex) : rawPath;
  const trimmed = staticPart.replace(/^\//, '').replace(/\/$/, '');

  if (!trimmed) return true; // bare '/' — app root, always valid
  if (trimmed.includes('${')) return null; // fully dynamic, can't check statically

  return (
    existsSync(resolve(APP_DIR, `${trimmed}.tsx`)) ||
    existsSync(resolve(APP_DIR, trimmed, 'index.tsx'))
  );
}

const CALL_PATTERNS = [
  /router\.push\(\s*'([^']+)'/g,
  /router\.push\(\s*"([^"]+)"/g,
  /router\.push\(\s*`([^`]+)`/g,
  /router\.replace\(\s*'([^']+)'/g,
  /router\.replace\(\s*"([^"]+)"/g,
  /router\.replace\(\s*`([^`]+)`/g,
  /(?<![.\w])push\(\s*\(?\s*`([^`]+)`/g,
  /(?<![.\w])push\(\s*\(?\s*'([^']+)'/g,
  /(?<![.\w])push\(\s*\(?\s*"([^"]+)"/g,
  /pathname:\s*'([^']+)'/g,
  /pathname:\s*"([^"]+)"/g,
];

function extractTargets(source: string): string[] {
  const targets: string[] = [];
  for (const pattern of CALL_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      targets.push(match[1]);
    }
  }
  return targets;
}

describe('buyer-area navigation targets', () => {
  const files = listBuyerFiles();

  it('found buyer screen files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const relative = file.replace(resolve(__dirname, '..') + '/', '');
    const source = readFileSync(file, 'utf8');
    const targets = extractTargets(source);

    it(`${relative}: every static navigation target resolves to a real route`, () => {
      for (const target of targets) {
        const result = routeExists(target);
        if (result === null) continue; // fully dynamic, not checkable
        expect(result, `${relative} navigates to "${target}", which has no matching app/ route`).toBe(true);
      }
    });
  }
});
