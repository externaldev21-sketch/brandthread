/**
 * SaveToCollectionSheet — orchestration tests.
 *
 * Pure logic tests (vitest environment: node, no render tree — matches the
 * pattern used by ShopProductSheet.test.tsx / EngagementButton.test.tsx in
 * this repo). Verifies the "Save to…" contract: picking a board saves the
 * item (idempotent on the server) and then files it into that board, and
 * "New collection" creates the board first before filing into it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCollections = vi.fn();
const mockCreateCollection = vi.fn();
const mockSaveItem = vi.fn();
const mockMoveSavedItemToCollection = vi.fn();

vi.mock('@/services/socialService', () => ({
  getCollections: (...args: unknown[]) => mockGetCollections(...args),
  createCollection: (...args: unknown[]) => mockCreateCollection(...args),
  saveItem: (...args: unknown[]) => mockSaveItem(...args),
  moveSavedItemToCollection: (...args: unknown[]) => mockMoveSavedItemToCollection(...args),
}));

import { getCollections, createCollection, saveItem, moveSavedItemToCollection } from '@/services/socialService';

const ITEM = { type: 'product' as const, targetId: 'prod_1', title: 'Ripstop Jacket', subtitle: 'Meridian Co.', accentColor: '#111', priceCents: 8000 };

/** Mirrors SaveToCollectionSheet's fileInto() handler. */
async function fileInto(item: typeof ITEM, collectionId: string | null) {
  await saveItem({
    type: item.type,
    targetId: item.targetId,
    title: item.title,
    subtitle: item.subtitle,
    accentColor: item.accentColor,
    priceCents: item.priceCents,
    collectionId,
  });
  await moveSavedItemToCollection(item.targetId, collectionId);
}

describe('SaveToCollectionSheet orchestration', () => {
  beforeEach(() => {
    mockGetCollections.mockReset();
    mockCreateCollection.mockReset();
    mockSaveItem.mockReset();
    mockMoveSavedItemToCollection.mockReset();
  });

  it('loads and sorts recent collections most-recently-updated first', async () => {
    mockGetCollections.mockResolvedValue([
      { id: 'c1', name: 'Old', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'c2', name: 'Newest', updatedAt: '2024-06-01T00:00:00Z' },
    ]);
    const rows = await getCollections();
    const sorted = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    expect(sorted.map(r => r.id)).toEqual(['c2', 'c1']);
  });

  it('saves the item then files it into the chosen board', async () => {
    mockSaveItem.mockResolvedValue({ id: 's1' });
    mockMoveSavedItemToCollection.mockResolvedValue({ id: 's1', collectionId: 'c1' });

    await fileInto(ITEM, 'c1');

    expect(mockSaveItem).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'prod_1', collectionId: 'c1', priceCents: 8000,
    }));
    expect(mockMoveSavedItemToCollection).toHaveBeenCalledWith('prod_1', 'c1');
  });

  it('files into "All Saved" (no board) when collectionId is null', async () => {
    mockSaveItem.mockResolvedValue({ id: 's1' });
    mockMoveSavedItemToCollection.mockResolvedValue({ id: 's1', collectionId: null });

    await fileInto(ITEM, null);

    expect(mockMoveSavedItemToCollection).toHaveBeenCalledWith('prod_1', null);
  });

  it('creates a new collection before filing into it', async () => {
    mockCreateCollection.mockResolvedValue({ id: 'c_new', name: 'Fall Fits' });
    mockSaveItem.mockResolvedValue({ id: 's1' });
    mockMoveSavedItemToCollection.mockResolvedValue({ id: 's1', collectionId: 'c_new' });

    const created = await createCollection('Fall Fits');
    await fileInto(ITEM, created.id);

    expect(mockCreateCollection).toHaveBeenCalledWith('Fall Fits');
    expect(mockMoveSavedItemToCollection).toHaveBeenCalledWith('prod_1', 'c_new');
  });

  it('surfaces a failure to save without filing into any board', async () => {
    mockSaveItem.mockRejectedValue(new Error('Network error'));

    await expect(fileInto(ITEM, 'c1')).rejects.toThrow('Network error');
    expect(mockMoveSavedItemToCollection).not.toHaveBeenCalled();
  });
});
