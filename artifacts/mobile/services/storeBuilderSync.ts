// ─── Store Builder lists ↔ server (storefronts.collections / pages / navigation)
// Pure helpers: shape-normalize what GET /api/store returns (the server only
// checks these are arrays) and turn save failures into honest error text.

import type {
  StoreCollection, StorePage, StoreMenu, StoreMenuItem, MenuType,
} from './storeTypes';

export type BuilderListKey = 'collections' | 'pages' | 'menus';

/** Column name on the server storefront row for each local list. */
export const SERVER_BUILDER_KEY: Record<BuilderListKey, 'collections' | 'pages' | 'navigation'> = {
  collections: 'collections',
  pages: 'pages',
  menus: 'navigation',
};

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function normalizeCollections(raw: unknown): StoreCollection[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date().toISOString();
  return raw.map(obj).filter((c): c is Record<string, unknown> => !!c && !!s(c.id)).map(c => ({
    ...(c as unknown as StoreCollection),
    id: s(c.id),
    type: c.type === 'automated' ? 'automated' : 'manual',
    name: s(c.name) || s(c.title) || 'Untitled collection',
    description: s(c.description),
    productIds: strings(c.productIds),
    productOrder: (s(c.productOrder) || 'manual') as StoreCollection['productOrder'],
    conditions: Array.isArray(c.conditions) ? (c.conditions as StoreCollection['conditions']) : [],
    conditionMatch: c.conditionMatch === 'any' ? 'any' : 'all',
    handle: s(c.handle),
    status: (['active', 'draft', 'scheduled', 'hidden'].includes(s(c.status)) ? s(c.status) : 'draft') as StoreCollection['status'],
    createdAt: s(c.createdAt, now),
    updatedAt: s(c.updatedAt, now),
  }));
}

export function normalizePages(raw: unknown): StorePage[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date().toISOString();
  return raw.map(obj).filter((p): p is Record<string, unknown> => !!p && !!s(p.id)).map(p => ({
    ...(p as unknown as StorePage),
    id: s(p.id),
    type: (s(p.type) || 'custom') as StorePage['type'],
    title: s(p.title) || 'Untitled page',
    slug: s(p.slug),
    content: s(p.content) || s(p.body),
    status: (['draft', 'published', 'scheduled', 'hidden'].includes(s(p.status)) ? s(p.status) : 'draft') as StorePage['status'],
    createdAt: s(p.createdAt, now),
    updatedAt: s(p.updatedAt, now),
  }));
}

function normalizeItems(raw: unknown, depth = 0): StoreMenuItem[] {
  if (!Array.isArray(raw) || depth > 3) return [];
  return raw.map(obj).filter((i): i is Record<string, unknown> => !!i && !!s(i.id)).map((i, idx) => ({
    ...(i as unknown as StoreMenuItem),
    id: s(i.id),
    label: s(i.label),
    target: (s(i.target) || 'none') as StoreMenuItem['target'],
    visible: i.visible !== false,
    order: typeof i.order === 'number' ? i.order : idx,
    children: normalizeItems(i.children, depth + 1),
  }));
}

export function normalizeMenus(raw: unknown): StoreMenu[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date().toISOString();
  return raw.map(obj).filter((m): m is Record<string, unknown> => !!m && !!s(m.id)).map(m => ({
    id: s(m.id),
    type: (['main', 'mobile', 'footer'].includes(s(m.type)) ? s(m.type) : 'main') as MenuType,
    name: s(m.name) || 'Menu',
    items: normalizeItems(m.items),
    updatedAt: s(m.updatedAt, now),
  }));
}

export function normalizeBuilderList(key: BuilderListKey, raw: unknown) {
  if (key === 'collections') return normalizeCollections(raw);
  if (key === 'pages') return normalizePages(raw);
  return normalizeMenus(raw);
}

/** Whether a local list holds anything the seller made (default empty menus don't count). */
export function hasBuilderContent(key: BuilderListKey, list: unknown[]): boolean {
  if (key === 'menus') return (list as StoreMenu[]).some(m => Array.isArray(m?.items) && m.items.length > 0);
  return list.length > 0;
}

/**
 * How to reconcile a local list with the server's on load.
 *  - 'use-remote': the server list is the source of truth;
 *  - 'upload-local': the server has nothing yet but this device holds lists
 *    made before builder state was saved server-side — push them up once;
 *  - 'keep-local': nothing on either side worth replacing (e.g. default menus).
 */
export function reconcileDecision(
  key: BuilderListKey,
  remote: unknown,
  local: unknown[],
  alreadySynced: boolean,
): 'use-remote' | 'upload-local' | 'keep-local' {
  if (!Array.isArray(remote)) return 'keep-local';
  if (remote.length > 0) return 'use-remote';
  const localHasContent = hasBuilderContent(key, local);
  if (!localHasContent) return 'keep-local';
  return alreadySynced ? 'use-remote' : 'upload-local';
}

/** Error text for a failed builder save — the UI shows this instead of pretending it saved. */
export function builderSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const status =
    typeof error === 'object' && error !== null && 'status' in error && typeof (error as any).status === 'number'
      ? (error as any).status as number
      : Number(message.match(/^API\s+(\d{3}):/i)?.[1]);
  if (status === 401 || status === 403) return 'Your session has expired. Sign in again, then retry.';
  if (status === 400) {
    if (/too large/i.test(message)) return 'This is too large to save. Remove some items and try again.';
    return 'The server rejected this change. Please check it and try again.';
  }
  if (Number.isInteger(status) && status >= 500) return 'Our servers could not save this right now. Please try again in a moment.';
  if (/network request failed|failed to fetch|fetch failed|network error|offline|timed?\s*out|connection/i.test(message)) {
    return "Couldn't reach Brandthread. Check your connection — nothing was saved.";
  }
  return "Couldn't save this change. Please try again.";
}
