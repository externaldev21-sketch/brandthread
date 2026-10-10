/**
 * The expo-router route table, read from app/ on disk, for tests that need
 * to know whether an href lands on a real screen.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const APP_DIR = path.resolve(__dirname, '..', '..', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const isGroup = (s: string) => /^\(.*\)$/.test(s);

/** Route patterns (groups removed): '/analytics', '/store/[handle]', '/'. */
export function appRoutePatterns(): string[][] {
  const routes: string[][] = [];
  for (const file of walk(APP_DIR)) {
    const rel = path.relative(APP_DIR, file).replace(/\.tsx?$/, '');
    const segs = rel.split(path.sep);
    const last = segs[segs.length - 1];
    if (last.startsWith('_') || last.startsWith('+')) continue;
    if (last === 'index') segs.pop();
    routes.push(segs.filter((s) => !isGroup(s)));
  }
  return routes;
}

let cache: string[][] | null = null;

/** True when `href` (query/hash allowed, groups optional) opens a screen file. */
export function routeExists(href: string): boolean {
  cache ??= appRoutePatterns();
  const pathname = href.split(/[?#]/)[0];
  const segs = pathname.split('/').filter(Boolean).filter((s) => !isGroup(s));
  return cache.some((pattern) =>
    pattern.length === segs.length &&
    pattern.every((p, i) => /^\[.+\]$/.test(p) || p === segs[i] || /\$\{/.test(segs[i])),
  );
}
