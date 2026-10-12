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
    expect(verified.settings.storeUrl).toBe('verified-store'); // bare slug — callers add the domain (BT-316)
    // Background verification must not mutate the already-painted snapshot.
    expect(snapshots[0].publishStatus).toBe('not_started');
    expect(snapshots[0].settings.storeUrl).not.toBe('verified-store'); // bare slug — callers add the domain (BT-316)
  });

  it('loads pages, menus, collections and editor state without any server reads', async () => {
    await getStorefront({ refreshRemote: false });
    await getPages();
    await getMenus();
    await getCollections();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('persists page edits immediately and still schedules server sync', async () => {
    const created = await createPage({ title: 'About us' });
    const id = created.pages[0].id;
    await updatePage(id, { title: 'Our story' });
    expect((await getPages())[0].title).toBe('Our story');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(2);
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
