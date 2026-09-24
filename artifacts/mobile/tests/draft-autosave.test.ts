import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory fake of AsyncStorage that mimics its persistence semantics closely
// enough to prove drafts round-trip the way the app relies on (survive
// "close/reopen" = a fresh call into the module with the same backing store).
const store: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
    getAllKeys: () => Promise.resolve(Object.keys(store)),
    multiGet: (keys: string[]) => Promise.resolve(keys.map(k => [k, store[k] ?? null] as [string, string | null])),
  },
}));

// productService also imports serviceConfig/money for its non-draft exports —
// stub those so this test doesn't have to pull in the full API client chain.
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/money', () => ({ centsAtBasisPoints: vi.fn(() => 0), parseDecimalToCents: vi.fn(() => 0), formatCents: vi.fn(() => '$0.00') }));

import { saveDraft, loadDraft, deleteDraft, listDrafts } from '@/services/productService';
import type { ProductDraft } from '@/services/productTypes';

function makeDraft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    id: 'draft_test1',
    isDraft: true,
    currentStep: 1,
    lastSavedAt: '2020-01-01T00:00:00.000Z',
    name: 'Untitled',
    ...overrides,
  };
}

describe('draft autosave persistence (survives app close/reopen)', () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
  });

  it('persists a draft and can load it back with the same content', async () => {
    const draft = makeDraft({ name: 'Vintage Tee' });
    await saveDraft(draft);

    const loaded = await loadDraft(draft.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Vintage Tee');
    expect(loaded?.isDraft).toBe(true);
  });

  it('stamps a fresh lastSavedAt on every save, so autosave timestamps advance', async () => {
    const draft = makeDraft({ lastSavedAt: '2000-01-01T00:00:00.000Z' });
    await saveDraft(draft);
    const loaded = await loadDraft(draft.id);
    // The service always re-stamps lastSavedAt rather than trusting the caller.
    expect(loaded?.lastSavedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(new Date(loaded!.lastSavedAt).getTime()).toBeGreaterThan(0);
  });

  it('loading an unknown draft id returns null instead of throwing', async () => {
    expect(await loadDraft('does-not-exist')).toBeNull();
  });

  it('simulates "app closed and reopened": a fresh load call still sees the saved draft', async () => {
    const draft = makeDraft({ id: 'draft_reopen', name: 'Resume me' });
    await saveDraft(draft);

    // "Reopening the app" is modeled here as a brand-new call sequence against
    // the same backing AsyncStorage — nothing in module state carries the
    // draft over, only the persisted store does.
    const resumed = await loadDraft('draft_reopen');
    expect(resumed?.name).toBe('Resume me');
  });

  it('overwrites the previous save for the same draft id on each autosave tick', async () => {
    const draft = makeDraft({ id: 'draft_versioned', name: 'v1' });
    await saveDraft(draft);
    await saveDraft({ ...draft, name: 'v2' });
    const loaded = await loadDraft('draft_versioned');
    expect(loaded?.name).toBe('v2');
  });

  it('deleteDraft removes the draft so it will not resurface on next load', async () => {
    const draft = makeDraft({ id: 'draft_to_delete' });
    await saveDraft(draft);
    await deleteDraft('draft_to_delete');
    expect(await loadDraft('draft_to_delete')).toBeNull();
  });

  it('listDrafts returns every saved draft, most recently saved first', async () => {
    await saveDraft(makeDraft({ id: 'draft_a', name: 'A' }));
    // Ensure a distinguishable ordering even if saves land in the same tick.
    await new Promise(r => setTimeout(r, 2));
    await saveDraft(makeDraft({ id: 'draft_b', name: 'B' }));

    const all = await listDrafts();
    const ids = all.map(d => d.id);
    expect(ids).toContain('draft_a');
    expect(ids).toContain('draft_b');
    // Most recent save (draft_b) should sort first.
    expect(ids[0]).toBe('draft_b');
  });

  it('does not throw when AsyncStorage.setItem fails (autosave failures are non-fatal)', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const spy = vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveDraft(makeDraft({ id: 'draft_fail' }))).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
