import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  get: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.storage.delete(key); }),
  },
}));
vi.mock('@/lib/api', () => ({
  api: { store: { get: mocks.get, save: mocks.save } },
}));
import {
  getStorefront, getPages, getMenus, getCollections, createPage, updatePage,
  createSection, updateSection, reorderSections, toggleSection,
  autosaveStorefront,
} from '../services/storeService';

beforeEach(() => {
  mocks.storage.clear();
  mocks.get.mockReset().mockResolvedValue({ status: 'draft' });
  mocks.save.mockReset().mockResolvedValue({});
});

describe('local store navigation does not wait for server reads', () => {
  it('paints the local draft while publication verification is still pending', async () => {
    let resolveRemote!: (value: unknown) => void;
    mocks.get.mockReturnValue(new Promise(resolve => { resolveRemote = resolve; }));
    let painted!: () => void;
    const paint = new Promise<void>(resolve => { painted = resolve; });
    const snapshots: Awaited<ReturnType<typeof getStorefront>>[] = [];
    let finished = false;
    const request = getStorefront({ onLocal: store => { snapshots.push(store); painted(); } })
      .then(store => { finished = true; return store; });
    await paint;
    expect(finished).toBe(false);
    expect(snapshots[0].publishStatus).toBe('not_started');
    resolveRemote({ status: 'published', publishedAt: '2026-10-06T12:00:00Z', slug: 'verified-store' });
    const verified = await request;
    expect(verified.publishStatus).toBe('published');
    // The bare subdomain: screens add ".brandthread.app" themselves (BT-316).
    expect(verified.settings.storeUrl).toBe('verified-store');
    // Background verification must not mutate the already-painted snapshot.
    expect(snapshots[0].publishStatus).toBe('not_started');
    expect(snapshots[0].settings.storeUrl).not.toBe('verified-store');
  });

  it('paints cached pages / menus / collections first, then takes the server lists', async () => {
    await getStorefront({ refreshRemote: false });
    expect(mocks.get).not.toHaveBeenCalled();
    // Builder lists are server state (storefronts.pages / navigation /
    // collections) so the live store and other devices see them.
    mocks.get.mockResolvedValue({
      status: 'draft',
      pages: [{ id: 'p1', title: 'About', slug: 'about', content: 'Hi', status: 'published' }],
      navigation: [],
      collections: [],
    });
    const painted: unknown[] = [];
    const pages = await getPages({ onLocal: list => painted.push(list) });
    expect(painted).toEqual([[]]);
    expect(pages.map(p => p.id)).toEqual(['p1']);
    expect((await getMenus()).map(m => m.type)).toEqual(['main', 'mobile', 'footer']);
    expect(await getCollections()).toEqual([]);
  });

  it('saves page edits to the server before reporting success', async () => {
    const created = await createPage({ title: 'About us' });
    const id = created.pages[0].id;
    await updatePage(id, { title: 'Our story' });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toEqual({ pages: [expect.objectContaining({ id, title: 'Our story' })] });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('section edits, reorder, toggles and autosave never preflight the network', async () => {
    const created = await createSection('hero_image', { heading: 'Before' });
    const id = created.sections.at(-1)!.id;
    await updateSection(id, { heading: 'After' });
    await toggleSection(id);
    const ordered = await reorderSections([id, ...created.sections.filter(s => s.id !== id).map(s => s.id)]);
    await autosaveStorefront({ sections: ordered.sections });
    const saved = await getStorefront({ refreshRemote: false });
    expect(saved.sections[0].id).toBe(id);
    expect(saved.sections[0].settings.heading).toBe('After');
    expect(saved.sections[0].enabled).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(5);
  });

  it('keeps default publication reads authoritative', async () => {
    mocks.get.mockResolvedValue({ status: 'published', sharePreviewRevokedAt: '2026-10-06' });
    const store = await getStorefront();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(store.publishStatus).toBe('published');
    expect(store.sharePreviewRevokedAt).toBe('2026-10-06');
  });
});
