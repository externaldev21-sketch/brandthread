import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ preview: false, demo: false, request: vi.fn() }));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => state.preview,
  isPreviewDemoMode: () => state.demo,
}));
vi.mock('@/lib/buildFlags', () => ({ NAVIGATION_ISOLATION_TEST: false }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: (...args: unknown[]) => state.request(...args) }));
vi.mock('@/lib/previewCatalog', () => ({ isPreviewCatalogEnabled: () => false, getPreviewCatalog: () => [] }));

import { getClosetOutfits, getClosetPieces, saveClosetOutfit } from '@/services/closetService';

beforeEach(() => {
  state.preview = false;
  state.demo = false;
  state.request.mockReset();
});

describe('closetService', () => {
  it('reads a real account from the API', async () => {
    state.request.mockResolvedValue({ pieces: [{ id: 'a' }] });
    expect(await getClosetPieces()).toEqual([{ id: 'a' }]);
    expect(state.request.mock.calls[0][0]).toBe('/api/buyer/closet/pieces');
  });

  it('saves an outfit by piece id', async () => {
    state.request.mockResolvedValue({ outfit: { id: 'o', pieces: [] } });
    await saveClosetOutfit(['a', 'b']);
    expect(state.request.mock.calls[0][0]).toBe('/api/buyer/closet/outfits');
    expect(JSON.parse(state.request.mock.calls[0][1].body)).toEqual({ pieceIds: ['a', 'b'] });
  });

  it('the fresh preview is an empty closet and never calls the API', async () => {
    state.preview = true;
    expect(await getClosetPieces()).toEqual([]);
    expect(await getClosetOutfits()).toEqual([]);
    expect(state.request).not.toHaveBeenCalled();
  });

  it('the demo preview asks the API and falls back quietly', async () => {
    state.preview = true;
    state.demo = true;
    state.request.mockRejectedValue(new Error('404'));
    expect(await getClosetPieces()).toEqual([]);
    expect(state.request).toHaveBeenCalledTimes(1);
  });
});

describe('unboxing', () => {
  it('asks the server and marks it seen', async () => {
    const { getUnboxing, markUnboxingSeen } = await import('@/services/closetService');
    state.request.mockResolvedValueOnce({ unboxing: { orderId: 'o', pieces: [] } });
    expect(await getUnboxing()).toEqual({ orderId: 'o', pieces: [] });
    state.request.mockResolvedValueOnce({ marked: 1 });
    await markUnboxingSeen();
    expect(state.request.mock.calls.map((c) => c[0])).toEqual(['/api/buyer/closet/unboxing', '/api/buyer/closet/unboxing/seen']);
  });

  it('never shows in the fresh preview', async () => {
    const { getUnboxing, markUnboxingSeen } = await import('@/services/closetService');
    state.preview = true;
    expect(await getUnboxing()).toBeNull();
    await markUnboxingSeen();
    expect(state.request).not.toHaveBeenCalled();
  });
});
