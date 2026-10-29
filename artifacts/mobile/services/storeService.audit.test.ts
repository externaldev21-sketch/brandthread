import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mem } = vi.hoisted(() => ({ mem: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => { mem.set(k, v); },
    removeItem: async (k: string) => { mem.delete(k); },
  },
}));
vi.mock('@/lib/api', () => ({ api: { store: { get: vi.fn(async () => ({})), save: vi.fn(async () => ({})) } } }));
// Signed-out seller preview: no server sync, no remote reads.
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => true, isBuyerDevPreview: () => false, isPreviewDemoMode: () => false,
}));

import {
  createSection, getStorefront, reorderSections, undoLastAction, updateSection,
} from './storeService';
import { parseServerSuggestion } from './storeAiActions';

const snapshot = async () => (await getStorefront({ refreshRemote: false })).sections
  .map(s => ({ id: s.id, type: s.type, heading: s.settings.heading }));

describe('store editor undo (audit)', () => {
  beforeEach(() => mem.clear());

  it('undo after adding a section removes it again', async () => {
    const before = await snapshot();
    await createSection('faq');
    expect((await snapshot()).length).toBe(before.length + 1);
    await undoLastAction();
    expect(await snapshot()).toEqual(before);
  });

  it('undo after editing a section restores its previous settings', async () => {
    const [first] = await snapshot();
    await updateSection(first.id, { heading: 'Changed' });
    await undoLastAction();
    expect((await snapshot())[0].heading).toBe(first.heading);
  });

  it('undo after a reorder restores the order without wiping the sections', async () => {
    const before = await snapshot();
    await reorderSections([...before].reverse().map(s => s.id));
    await undoLastAction();
    expect(await snapshot()).toEqual(before);
  });
});

describe('Improve Store screen actions (audit)', () => {
  it('rejects an object-prototype key as a screen', () => {
    const base = { category: 'copy', title: 'T', problem: 'P', recommendation: 'R' };
    expect(parseServerSuggestion({ ...base, action: { type: 'open_screen', screen: 'constructor' } })).toBeNull();
    expect(parseServerSuggestion({ ...base, action: { type: 'open_screen', screen: 'toString' } })).toBeNull();
  });
});
