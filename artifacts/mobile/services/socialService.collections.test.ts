import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));

import {
  getCollections, createCollection, updateCollection, deleteCollection,
  reorderCollections, getCollectionItems, moveSavedItemToCollection,
  getPublicCollection, saveItem,
} from './socialService';

describe('saved collections CRUD', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('lists collections from the server', async () => {
    const rows = [{ id: 'c1', name: 'Fall Fits', itemCount: 3, isPublic: false, sortOrder: 0, createdAt: 'x', updatedAt: 'x', coverImageUrl: null }];
    serviceRequest.mockResolvedValue(rows);

    await expect(getCollections()).resolves.toEqual(rows);
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/collections');
  });

  it('creates a collection', async () => {
    const created = { id: 'c1', name: 'Winter', itemCount: 0, isPublic: false, sortOrder: 0, createdAt: 'x', updatedAt: 'x' };
    serviceRequest.mockResolvedValue(created);

    await expect(createCollection('Winter')).resolves.toEqual(created);
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/collections', {
      method: 'POST',
      body: JSON.stringify({ name: 'Winter' }),
    });
  });

  it('renames, sets cover, and toggles public via PATCH', async () => {
    serviceRequest.mockResolvedValue({ id: 'c1', name: 'New Name', isPublic: true });

    await updateCollection('c1', { name: 'New Name', isPublic: true });
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/collections/c1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name', isPublic: true }),
    });
  });

  it('deletes a collection', async () => {
    serviceRequest.mockResolvedValue({ ok: true });
    await deleteCollection('c1');
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/collections/c1', { method: 'DELETE' });
  });

  it('persists reorder as an ordered id list', async () => {
    serviceRequest.mockResolvedValue({ ok: true });
    await reorderCollections(['c2', 'c1']);
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/collections/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds: ['c2', 'c1'] }),
    });
  });

  it('fetches a single collection with its items', async () => {
    const payload = { collection: { id: 'c1' }, items: [] };
    serviceRequest.mockResolvedValue(payload);
    await expect(getCollectionItems('c1')).resolves.toEqual(payload);
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/collections/c1/items');
  });

  it('moves a saved item into (or out of, via null) a collection', async () => {
    serviceRequest.mockResolvedValue({ id: 's1', collectionId: 'c1' });
    await moveSavedItemToCollection('target-1', 'c1');
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/saved/target-1', {
      method: 'PATCH',
      body: JSON.stringify({ collectionId: 'c1' }),
    });

    await moveSavedItemToCollection('target-1', null);
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/saved/target-1', {
      method: 'PATCH',
      body: JSON.stringify({ collectionId: null }),
    });
  });

  it('reads a public collection without requiring auth error reporting', async () => {
    const payload = { collection: { id: 'c1', name: 'Public board', ownerName: 'Ava' }, items: [] };
    serviceRequest.mockResolvedValue(payload);
    await expect(getPublicCollection('c1')).resolves.toEqual(payload);
    expect(serviceRequest).toHaveBeenCalledWith('/api/public/collections/c1', {}, false);
  });

  it('saves a product with a collectionId and price snapshot in one call', async () => {
    serviceRequest.mockResolvedValue({ id: 's1' });
    await saveItem({ type: 'product', targetId: 't1', title: 'Jacket', collectionId: 'c1', priceCents: 5000 });
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/saved', {
      method: 'POST',
      body: JSON.stringify({ type: 'product', targetId: 't1', title: 'Jacket', collectionId: 'c1', priceCents: 5000 }),
    });
  });
});
