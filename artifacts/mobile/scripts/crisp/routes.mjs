/**
 * Every screen route in app/, derived from the file tree (expo-router's own
 * rules): `_layout`, `+html` and `+not-found` are not screens, `index` is its
 * folder, `(group)` folders stay in the URL (expo-router web accepts them and
 * they pin the right tab stack), and `[param]` segments get a sample value.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

const SAMPLE_PARAMS = {
  placeId: 'demo-place',
  postId: 'post_demo_1',
  collectionId: 'col_demo_1',
  tag: 'streetwear',
  handle: 'northlinestudio',
  productId: 'prod_nl_jacket_rust',
  username: 'northlinestudio',
  code: 'DEMO2026',
  dropId: 'drop_demo_1',
};

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx$/.test(entry.name)) yield full;
  }
}

/** Route path for one screen file (relative to app/), or null if it isn't a screen. */
export function routeForFile(relativeFile) {
  const parts = relativeFile.replace(/\.tsx$/, '').split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (name.startsWith('_') || name.startsWith('+')) return null;
  if (/\.(web|native|ios|android)$/.test(name)) return null;
  if (parts.some((p) => p === '__tests__' || p.endsWith('.test'))) return null;
  if (name === 'index') parts.pop();
  const segments = parts.map((p) => {
    const m = /^\[(\.\.\.)?(\w+)\]$/.exec(p);
    return m ? (SAMPLE_PARAMS[m[2]] ?? 'demo') : p;
  });
  return `/${segments.join('/')}`;
}

/** [{ route, file }] for every screen, sorted by route. */
export function listRoutes(appDir) {
  const out = [];
  for (const file of walk(appDir)) {
    const rel = path.relative(appDir, file);
    const route = routeForFile(rel);
    if (route) out.push({ route, file: `app/${rel.split(path.sep).join('/')}` });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** File-system safe name for a route ("/" → "index"). */
export function slugForRoute(route) {
  return route === '/' ? 'index' : route.replace(/^\//, '').replace(/[()]/g, '').replace(/[^\w.-]+/g, '_');
}
