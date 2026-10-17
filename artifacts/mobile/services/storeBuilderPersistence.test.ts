import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/networkNotice';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  get: vi.fn(),
  save: vi.fn(),
  suggestions: vi.fn(),
  demo: false,
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.storage.delete(key); }),
  },
}));
vi.mock('@/lib/api', () => ({
  api: { store: { get: mocks.get, save: mocks.save, suggestions: mocks.suggestions } },
}));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => mocks.demo }));

import {
  createCollection, getCollections, getMenus, getPages, updateMenu,
  generateAISuggestions, applyAISuggestion, getStorefront, StoreSaveError,
  AISuggestionsUnavailableError, storefrontStorageKey,
} from './storeService';

beforeEach(() => {
  mocks.storage.clear();
  mocks.demo = false;
  mocks.get.mockReset().mockResolvedValue({ status: 'draft', collections: [], pages: [], navigation: [] });
  mocks.save.mockReset().mockResolvedValue({});
  mocks.suggestions.mockReset();
});

describe('collections / pages / menus persist to the server', () => {
  it('a failed save throws a real error and leaves the cache untouched', async () => {
    mocks.save.mockRejectedValueOnce(new ApiError(500, 'boom'));
    await expect(createCollection({ name: 'Summer' })).rejects.toBeInstanceOf(StoreSaveError);
    expect((await getStorefront({ refreshRemote: false })).collections).toEqual([]);
  });

  it('sends the collection list as storefronts.collections', async () => {
    await createCollection({ name: 'Summer', productIds: ['p1'] });
    expect(mocks.save).toHaveBeenCalledWith({ collections: [expect.objectContaining({ name: 'Summer', productIds: ['p1'] })] });
  });

  it('menus are saved as navigation', async () => {
    const [main] = await getMenus();
    await updateMenu(main.id, [{ id: 'i', label: 'About', target: 'page', targetId: 'about', visible: true, order: 0, children: [] }]);
    const payload = mocks.save.mock.calls.at(-1)![0];
    expect(Object.keys(payload)).toEqual(['navigation']);
    expect(payload.navigation[0].items[0].label).toBe('About');
  });

  it('loads lists from the server (source of truth)', async () => {
    mocks.get.mockResolvedValue({ collections: [{ id: 'remote', name: 'From web', status: 'active' }] });
    expect((await getCollections()).map(c => c.id)).toEqual(['remote']);
  });

  it('falls back to the cache when offline', async () => {
    await createCollection({ name: 'Cached' });
    mocks.get.mockRejectedValue(new TypeError('Network request failed'));
    expect((await getCollections()).map(c => c.name)).toEqual(['Cached']);
  });

  it('uploads phone-only lists made before server sync, once', async () => {
    const legacy = await getStorefront({ refreshRemote: false });
    legacy.pages = [{ id: 'old', type: 'about', title: 'About', slug: 'about', content: '', status: 'published', createdAt: '', updatedAt: '' }];
    mocks.storage.set(await storefrontStorageKey(), JSON.stringify(legacy));
    await getPages();
    expect(mocks.save).toHaveBeenCalledWith({ pages: [expect.objectContaining({ id: 'old' })] });
    mocks.save.mockClear();
    // Now synced: an empty server list is the truth (deleted elsewhere).
    expect(await getPages()).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('demo mode stays on-device', async () => {
    mocks.demo = true;
    await createCollection({ name: 'Demo' });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe('Improve Store suggestions', () => {
  const reply = {
    suggestions: [
      { category: 'copy', title: 'SEO title', problem: 'Empty.', recommendation: 'Add one.', action: { type: 'set_seo_title', value: 'Nightshift — Tees' } },
      { category: 'product', title: 'Collections', problem: 'None live.', recommendation: 'Publish one.', action: { type: 'open_screen', screen: 'collections' } },
    ],
  };

  it('uses the server AI, not the built-in list', async () => {
    mocks.suggestions.mockResolvedValue(reply);
    const s = await generateAISuggestions();
    expect(s.aiSuggestions.map(x => x.title)).toEqual(['SEO title', 'Collections']);
  });

  it('reports AI unavailable instead of falling back', async () => {
    mocks.suggestions.mockRejectedValue(new ApiError(503, '{"error":"AI suggestions are unavailable right now.","code":"ai_unavailable"}'));
    await expect(generateAISuggestions()).rejects.toBeInstanceOf(AISuggestionsUnavailableError);
    expect((await getStorefront({ refreshRemote: false })).aiSuggestions).toEqual([]);
  });

  it('Apply saves the change via PUT /api/store and only then marks it applied', async () => {
    mocks.suggestions.mockResolvedValue(reply);
    const s = await generateAISuggestions();
    const seo = s.aiSuggestions[0];

    mocks.save.mockRejectedValueOnce(new ApiError(500, 'x'));
    await expect(applyAISuggestion(seo.id)).rejects.toBeInstanceOf(StoreSaveError);
    let cached = await getStorefront({ refreshRemote: false });
    expect(cached.aiSuggestions[0].applied).toBe(false);
    expect(cached.seo.homepageTitle).toBe('');

    await applyAISuggestion(seo.id);
    expect(mocks.save.mock.calls.at(-1)![0].seo).toMatchObject({ metaTitle: 'Nightshift — Tees' });
    cached = await getStorefront({ refreshRemote: false });
    expect(cached.aiSuggestions[0].applied).toBe(true);
    expect(cached.seo.homepageTitle).toBe('Nightshift — Tees');
  });

  it('screen suggestions navigate instead of pretending to apply', async () => {
    mocks.suggestions.mockResolvedValue(reply);
    const s = await generateAISuggestions();
    mocks.save.mockClear();
    const r = await applyAISuggestion(s.aiSuggestions[1].id);
    expect(r.navigateTo).toBe('/store-collections');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
