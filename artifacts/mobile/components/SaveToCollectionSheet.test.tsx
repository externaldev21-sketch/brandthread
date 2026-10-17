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

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'u1', isSignedIn: true }) }));
vi.mock('@/components/BrandthreadUI', () => ({ HapticSwitch: () => null }));
vi.mock('@/components/ui/BottomSheet', () => ({ Sheet: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/haptics', () => ({ hapticError: vi.fn() }));

describe('SaveToCollectionSheet real helpers', () => {
  beforeEach(() => {
    mockCreateCollection.mockReset(); mockSaveItem.mockReset(); mockMoveSavedItemToCollection.mockReset();
  });

  it('creates atomically with private default visibility and trims/caps name', async () => {
    const { createAndFile } = await import('./SaveToCollectionSheet');
    mockCreateCollection.mockResolvedValue({ id: 'c9', name: 'x' });
    mockSaveItem.mockResolvedValue({}); mockMoveSavedItemToCollection.mockResolvedValue({});
    await createAndFile(ITEM, '  ' + 'a'.repeat(40) + ' ', false, () => true);
    expect(mockCreateCollection).toHaveBeenCalledWith('a'.repeat(30), { isPublic: false });
    expect(mockMoveSavedItemToCollection).toHaveBeenCalledWith('prod_1', 'c9');
  });

  it('passes isPublic=true when toggled', async () => {
    const { createAndFile } = await import('./SaveToCollectionSheet');
    mockCreateCollection.mockResolvedValue({ id: 'c9', name: 'x' });
    mockSaveItem.mockResolvedValue({}); mockMoveSavedItemToCollection.mockResolvedValue({});
    await createAndFile(ITEM, 'Fits', true, () => true);
    expect(mockCreateCollection).toHaveBeenCalledWith('Fits', { isPublic: true });
  });

  it('rejects empty names without any request', async () => {
    const { createAndFile } = await import('./SaveToCollectionSheet');
    await expect(createAndFile(ITEM, '   ', false, () => true)).rejects.toThrow();
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it('stops filing when the account switches mid-flight', async () => {
    const { fileItemInto, StaleAccountError } = await import('./SaveToCollectionSheet');
    let current = true;
    mockSaveItem.mockImplementation(async () => { current = false; return {}; });
    await expect(fileItemInto(ITEM, 'c1', () => current)).rejects.toBeInstanceOf(StaleAccountError);
    expect(mockMoveSavedItemToCollection).not.toHaveBeenCalled();
  });

  it('makes no request when signed out (no bound account)', async () => {
    const { fileItemInto } = await import('./SaveToCollectionSheet');
    await expect(fileItemInto(ITEM, null, () => false)).rejects.toThrow();
    expect(mockSaveItem).not.toHaveBeenCalled();
  });

  it('retry after filing failure reuses the created collection (create called once)', async () => {
    const { createAndFile } = await import('./SaveToCollectionSheet');
    mockCreateCollection.mockResolvedValue({ id: 'c7', name: 'Fits' });
    mockSaveItem.mockRejectedValueOnce(new Error('net')).mockResolvedValue({});
    mockMoveSavedItemToCollection.mockResolvedValue({});
    let pending: unknown = null;
    await expect(createAndFile(ITEM, 'Fits', false, () => true, null, (c) => { pending = c; })).rejects.toThrow('net');
    expect(pending).toEqual({ id: 'c7', name: 'Fits' });
    const done = await createAndFile(ITEM, 'Fits', false, () => true, pending as never);
    expect(done.id).toBe('c7');
    expect(mockCreateCollection).toHaveBeenCalledTimes(1);
    expect(mockMoveSavedItemToCollection).toHaveBeenCalledWith('prod_1', 'c7');
  });

  it('does not file into a created collection after an account switch', async () => {
    const { createAndFile, StaleAccountError } = await import('./SaveToCollectionSheet');
    let current = true;
    mockCreateCollection.mockImplementation(async () => { current = false; return { id: 'c8', name: 'x' }; });
    await expect(createAndFile(ITEM, 'x', false, () => current)).rejects.toBeInstanceOf(StaleAccountError);
    expect(mockSaveItem).not.toHaveBeenCalled();
  });
});
