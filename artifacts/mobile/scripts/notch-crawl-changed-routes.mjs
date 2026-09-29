#!/usr/bin/env node
/**
 * Maps a PR's changed `app/**\/*.tsx` files to their route paths, for the
 * notch-crawl CI workflow's fast mode (NOTCH_CRAWL_ROUTES): depth-1 button
 * tapping only runs on routes the PR actually touched, instead of every
 * route in the app, so a small PR doesn't pay for a full crawl.
 *
 * Reads a newline-separated list of changed file paths from stdin (as
 * `git diff --name-only` prints them, repo-root-relative) and prints a
 * comma-separated route list to stdout.
 *
 * Scope note: a changed `components/**` file (a shared header, a shared
 * button) isn't mapped to specific routes here — there's no cheap way to
 * know which screens import it — so it doesn't widen the depth-1
 * allowlist. Every route still gets its depth-0 check regardless (which
 * already covers shared header/footer components rendered on that route),
 * so a shared-component regression is still caught; it just doesn't get
 * the deeper per-button probe on every route that uses it. The nightly
 * scheduled run (see .github/workflows/notch-crawl.yml) covers that
 * exhaustively.
 */
import { readFileSync } from 'node:fs';

const ROUTE_OVERRIDES = {
  '/c/[collectionId]': '/c/col_demo',
  '/drops/[dropId]': '/drops/drop_nl_04',
  '/store/product/[productId]': '/store/product/prod_nl_hoodie_ember',
  '/u/[username]': '/u/northlinestudio',
};

function fileToRoute(relPath) {
  const match = relPath.match(/^artifacts\/mobile\/app\/(.*)\.tsx$/);
  if (!match) return null;
  const parts = match[1].split('/');
  const last = parts[parts.length - 1];
  if (last === '_layout' || last.startsWith('+') || last.endsWith('.test')) return null;
  const segment = last === 'index' ? '' : `/${last}`;
  const cleanPrefix = parts
    .slice(0, -1)
    .filter((p) => !/^\(.*\)$/.test(p))
    .map((p) => `/${p}`)
    .join('');
  const route = `${cleanPrefix}${segment}` || '/';
  return ROUTE_OVERRIDES[route] ?? route;
}

const input = readFileSync(0, 'utf8');
const routes = new Set();
for (const line of input.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const route = fileToRoute(trimmed);
  if (route) routes.add(route);
}

process.stdout.write([...routes].join(','));
