import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
  },
}));

import { buildSearchChips, PINNED_CHIP_KEYS } from '@/lib/searchCategories';
import {
  addRecentSearch, clearRecentSearches, dropRecent, loadRecentSearches, mergeRecent,
  pushRecent, removeRecentSearch, MAX_RECENT_SEARCHES, RECENT_SEARCHES_KEY,
} from '@/lib/recentSearches';
import { appendPage, handleFor, mergeTrendingBrands } from '@/lib/searchResults';

const ROOT = path.resolve(__dirname, '..');

/** STYLE_TAGS keys/labels, read from source so this test needs no RN renderer. */
function styleTagsFromSource(): Array<{ key: string; label: string }> {
  const src = readFileSync(path.join(ROOT, 'components/StyleTagsPicker.tsx'), 'utf8');
  return [...src.matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => ({ key: m[1], label: m[2] }));
}

describe('category chips', () => {
  const styleTags = styleTagsFromSource();

  it('pins Streetwear, Vintage, Y2K, Accessories first, then every other style tag', () => {
    const chips = buildSearchChips(styleTags);
    expect(chips.slice(0, 4).map((c) => c.label)).toEqual(['Streetwear', 'Vintage', 'Y2K', 'Accessories']);
    expect(chips).toHaveLength(styleTags.length + 1);
    expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
    expect(PINNED_CHIP_KEYS).toHaveLength(4);
  });

  it('matches the keys the API accepts as ?style= (api-server lib/searchRanking.ts)', () => {
    const server = readFileSync(path.join(ROOT, '../api-server/src/lib/searchRanking.ts'), 'utf8');
    const styleBlock = /SEARCH_STYLE_KEYS = \[([\s\S]*?)\] as const/.exec(server)?.[1] ?? '';
    const catBlock = /SEARCH_CATEGORY_CHIP_KEYS = \[([\s\S]*?)\] as const/.exec(server)?.[1] ?? '';
    const serverKeys = [...`${styleBlock},${catBlock}`.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(buildSearchChips(styleTags).map((c) => c.key).sort()).toEqual(serverKeys);
  });
});

describe('recent searches', () => {
  beforeEach(() => storage.clear());

  it('pushes newest first, de-dupes case-insensitively, trims, and caps', () => {
    expect(pushRecent(['Denim', 'tee'], '  denim ')).toEqual(['denim', 'tee']);
    expect(pushRecent(['a'], '   ')).toEqual(['a']);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(pushRecent(many, 'new')).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it('merges device history ahead of server history without duplicates', () => {
    expect(mergeRecent(['Hoodie', 'cargo'], ['hoodie', 'denim', 'Cargo', 'tee'])).toEqual(['Hoodie', 'cargo', 'denim', 'tee']);
    expect(dropRecent(['Hoodie', 'tee'], 'hoodie')).toEqual(['tee']);
  });

  it('persists to AsyncStorage and survives a reload', async () => {
    await addRecentSearch('vintage tee');
    await addRecentSearch('y2k');
    expect(JSON.parse(storage.get(RECENT_SEARCHES_KEY)!)).toEqual(['y2k', 'vintage tee']);
    expect(await loadRecentSearches()).toEqual(['y2k', 'vintage tee']);
    await removeRecentSearch('Y2K');
    expect(await loadRecentSearches()).toEqual(['vintage tee']);
    await clearRecentSearches();
    expect(await loadRecentSearches()).toEqual([]);
  });

  it('ignores corrupt storage', async () => {
    storage.set(RECENT_SEARCHES_KEY, '{not json');
    expect(await loadRecentSearches()).toEqual([]);
    storage.set(RECENT_SEARCHES_KEY, JSON.stringify(['ok', 3, null]));
    expect(await loadRecentSearches()).toEqual(['ok']);
  });
});

describe('search result helpers', () => {
  it('tops up trending brands with suggested ones, de-duped and capped', () => {
    const merged = mergeTrendingBrands(
      [{ id: 's1', sellerId: 's1', name: 'Northline', verified: true, followerCount: 1200 }],
      [
        { sellerId: 's1', name: 'Northline' },
        { sellerId: 's2', name: 'Atlas Goods', handle: '@atlas', followerCount: 0 },
        { sellerId: 's3', name: 'Coldform' },
      ],
      () => '#000',
      2,
    );
    expect(merged.map((b) => b.name)).toEqual(['Northline', 'Atlas Goods']);
    expect(merged[0]).toMatchObject({ handle: '@northline', verified: true, followersLabel: '1.2K followers' });
    expect(merged[1]).toMatchObject({ handle: '@atlas', followersLabel: undefined });
  });

  it('appends a page without repeating ids', () => {
    expect(appendPage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('derives a handle from a display name', () => {
    expect(handleFor('Atelier Noire!')).toBe('@ateliernoire');
  });
});
