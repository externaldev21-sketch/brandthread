/**
 * Screen consolidation: every old route that was merged or removed must
 * still land somewhere real, and nothing in the app may link to a path that
 * has no screen.
 *
 * - lib/navigation/legacyRoutes maps old paths → new homes (+not-found.tsx
 *   applies it, so push payloads, emailed links and bookmarks keep working).
 * - docs/route-map.md is the human-readable copy of that map.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_ROUTES,
  mergeHref,
  normalizeLegacyPath,
  resolveLegacyRoute,
} from '../lib/navigation/legacyRoutes';
import { routeExists } from './helpers/appRoutes';
import { navTargets } from './helpers/navTargets';

const ROOT = path.resolve(__dirname, '..');
const API_SRC = path.resolve(ROOT, '..', 'api-server', 'src');

const SAMPLE_PARAMS = { orderId: 'o1', id: 'x1', projectId: 'p1', section: 's', productId: 'pr1' };

describe('resolveLegacyRoute', () => {
  it('returns null for paths that were never moved', () => {
    expect(resolveLegacyRoute('/design-canvas')).toBeNull();
    expect(resolveLegacyRoute('')).toBeNull();
    expect(resolveLegacyRoute('/totally-unknown')).toBeNull();
  });

  it('maps a moved path and carries its query over', () => {
    expect(resolveLegacyRoute('/ai-assistant')).toBe('/ai-brain');
    expect(resolveLegacyRoute('/app-icon?from=menu')).toBe('/appearance?from=menu');
  });

  it("keeps the target's own params when the old query clashes", () => {
    expect(resolveLegacyRoute('/drafts?filter=all')).toBe('/(tabs)/products?filter=draft');
    expect(mergeHref('/a?x=1', { x: '2', y: '3' })).toBe('/a?x=1&y=3');
  });

  it('runs function targets with the old params', () => {
    expect(resolveLegacyRoute('/shipping-label?orderId=abc')).toBe('/fulfill-order?orderId=abc&step=3');
    expect(resolveLegacyRoute('/shipping-label')).toBe('/(tabs)/orders');
  });

  it('accepts params passed separately (useGlobalSearchParams on native)', () => {
    expect(resolveLegacyRoute('/shipping-label', { orderId: 'o9' })).toBe('/fulfill-order?orderId=o9&step=3');
  });

  it('normalizes Expo dev links, trailing slashes, hashes and case', () => {
    expect(normalizeLegacyPath('/--/App-Icon/')).toBe('/app-icon');
    expect(resolveLegacyRoute('/--/app-icon/')).toBe('/appearance');
    expect(resolveLegacyRoute('/app-icon#top')).toBe('/appearance');
    expect(resolveLegacyRoute('app-icon')).toBe('/appearance');
  });

  it('encodes carried-over values', () => {
    expect(resolveLegacyRoute('/app-icon?q=a%20b%26c')).toBe('/appearance?q=a%20b%26c');
  });
});

describe('legacy route map', () => {
  it('lists each old path once', () => {
    const froms = LEGACY_ROUTES.map((r) => r.from);
    expect(new Set(froms).size).toBe(froms.length);
    for (const f of froms) expect(f, f).toBe(normalizeLegacyPath(f));
  });

  it('only lists paths that no longer have a screen (otherwise the redirect never runs)', () => {
    for (const r of LEGACY_ROUTES) expect(routeExists(r.from), `${r.from} still has a screen file`).toBe(false);
  });

  it('sends every old path to a screen that exists, in one hop', () => {
    for (const r of LEGACY_ROUTES) {
      const target = typeof r.to === 'function' ? r.to(SAMPLE_PARAMS) : r.to;
      const empty = typeof r.to === 'function' ? r.to({}) : r.to;
      for (const t of [target, empty]) {
        expect(routeExists(t), `${r.from} → ${t}`).toBe(true);
        expect(resolveLegacyRoute(t.split('?')[0]), `${r.from} → ${t} chains into another redirect`).toBeNull();
      }
    }
  });

  it('is written up in docs/route-map.md', () => {
    const doc = readFileSync(path.join(ROOT, 'docs', 'route-map.md'), 'utf8');
    for (const r of LEGACY_ROUTES) expect(doc, `${r.from} missing from docs/route-map.md`).toContain(`\`${r.from}\``);
  });

  it('the root stack registers no screen that was removed', () => {
    const layout = readFileSync(path.join(ROOT, 'app', '_layout.tsx'), 'utf8');
    const names = [...layout.matchAll(/<Stack\.Screen\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(50);
    const missing = names.filter((n) => !n.startsWith('+') && !routeExists(`/${n.replace(/(^|\/)index$/, '')}`));
    expect(missing).toEqual([]);
  });

  it('+not-found applies the map before showing "doesn\'t exist"', () => {
    const src = readFileSync(path.join(ROOT, 'app', '+not-found.tsx'), 'utf8');
    expect(src).toContain('resolveLegacyRoute');
    expect(src).toMatch(/if \(legacyTarget\) return <Redirect/);
  });
});

describe('no broken in-app links', () => {
  it('every hardcoded navigation target opens a real screen', () => {
    const broken = navTargets()
      .filter((t) => !routeExists(t.target))
      // goBackOr's doc comment shows a made-up example path.
      .filter((t) => !(t.file === 'lib/navigation/goBackOr.ts' && t.target === '/welcome'))
      .map((t) => `${t.file}:${t.line} → ${t.target}`);
    expect(broken).toEqual([]);
  });

  it('nothing links to an old path; links go straight to the new home', () => {
    const froms = new Set(LEGACY_ROUTES.map((r) => r.from));
    const stale = navTargets()
      .filter((t) => froms.has(normalizeLegacyPath(t.target)))
      .map((t) => `${t.file}:${t.line} → ${t.target}`);
    expect(stale).toEqual([]);
  });
});

describe('links the server sends into the app', () => {
  const routesIn = (file: string, re: RegExp) => {
    const src = readFileSync(path.join(API_SRC, file), 'utf8');
    return [...src.matchAll(re)].map((m) => m[1]);
  };
  const lands = (href: string) => routeExists(href) || resolveLegacyRoute(href) !== null;

  it('AI help answers (aiHelpDocs.ts routes) all land on a screen', () => {
    const routes = routesIn('lib/aiHelpDocs.ts', /route:\s*"([^"]+)"/g);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(lands(r), r).toBe(true);
  });

  it('push / account-deletion action routes all land on a screen', () => {
    const routes = [
      ...routesIn('jobs/sellerTrialReminder.ts', /route:\s*"([^"]+)"/g),
      ...routesIn('lib/accountDeletion.ts', /actionRoute:\s*"([^"]+)"/g),
    ];
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(lands(r), r).toBe(true);
  });

  it('payment return URLs (brandthreadCallbackUrls.ts) open real screens', () => {
    // Only the https://<web origin>/<path> branch; brandthread:// links match on hostname.
    const src = readFileSync(path.join(API_SRC, 'lib/brandthreadCallbackUrls.ts'), 'utf8');
    const webBranch = src.slice(src.indexOf('const configuredOrigin'));
    const paths = [...webBranch.matchAll(/url\.pathname === "(\/[a-z-]+)"/g)]
      .map((m) => m[1])
      .filter((p) => p !== '/manufacturers/payment'); // manufacturer portal, not the app
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(routeExists(p), p).toBe(true);
  });
});
