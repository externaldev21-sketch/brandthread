/**
 * Old routes → their new homes.
 *
 * Screens that were merged or removed no longer have a file in app/. Anything
 * that still opens one of their old paths (a push notification, an emailed or
 * bookmarked link, a deep link, a stale in-app link) lands on +not-found.tsx,
 * which asks `resolveLegacyRoute` for the new home and replaces the URL.
 *
 * The full old → new map lives in the per-area files below; docs/route-map.md
 * is the human-readable copy (tests/legacy-routes.test.ts keeps both honest).
 */
import { ANALYTICS_LEGACY_ROUTES } from './analytics';
import { CORE_LEGACY_ROUTES } from './core';
import { SETTINGS_LEGACY_ROUTES } from './settings';
import { STUDIO_LEGACY_ROUTES } from './studio';
import type { LegacyParams, LegacyRoute } from './types';

export type { LegacyParams, LegacyRoute } from './types';

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  ...CORE_LEGACY_ROUTES,
  ...ANALYTICS_LEGACY_ROUTES,
  ...STUDIO_LEGACY_ROUTES,
  ...SETTINGS_LEGACY_ROUTES,
];

const BY_PATH = new Map<string, LegacyRoute>(LEGACY_ROUTES.map((r) => [r.from, r]));

/** '/--/analytics-sales/' (Expo dev links) and '/analytics-sales' both → '/analytics-sales'. */
export function normalizeLegacyPath(pathname: string): string {
  let p = pathname.trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/^\/--(?=\/)/, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.toLowerCase();
}

function parseQuery(query: string): LegacyParams {
  const out: LegacyParams = {};
  const q = query.startsWith('?') ? query.slice(1) : query;
  if (!q) return out;
  for (const part of q.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const rawKey = i === -1 ? part : part.slice(0, i);
    const rawVal = i === -1 ? '' : part.slice(i + 1);
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, ' '))] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      out[rawKey] = rawVal;
    }
  }
  return out;
}

function buildQuery(params: LegacyParams): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Carries the old query over onto a fixed target; the target's own params win. */
export function mergeHref(target: string, oldParams: LegacyParams): string {
  const qi = target.indexOf('?');
  const path = qi === -1 ? target : target.slice(0, qi);
  const own = qi === -1 ? {} : parseQuery(target.slice(qi));
  return `${path}${buildQuery({ ...oldParams, ...own })}`;
}

/**
 * New href for an old path, or null when the path was never a moved route.
 * Accepts a pathname with or without a query string; `params` (e.g. from
 * useGlobalSearchParams) are merged in when the path has none of its own.
 */
export function resolveLegacyRoute(pathWithQuery: string, params: LegacyParams = {}): string | null {
  if (!pathWithQuery) return null;
  const hashless = pathWithQuery.split('#')[0];
  const qi = hashless.indexOf('?');
  const pathname = qi === -1 ? hashless : hashless.slice(0, qi);
  const route = BY_PATH.get(normalizeLegacyPath(pathname));
  if (!route) return null;
  const merged: LegacyParams = { ...params, ...(qi === -1 ? {} : parseQuery(hashless.slice(qi))) };
  return typeof route.to === 'function' ? route.to(merged) : mergeHref(route.to, merged);
}
