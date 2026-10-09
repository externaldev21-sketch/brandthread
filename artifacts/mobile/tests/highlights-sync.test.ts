/**
 * lib/highlightsService.ts: local cache + server sync.
 * - signed out / preview: purely local (no network calls)
 * - signed in: server list wins, local-only highlights are uploaded once,
 *   edits/deletes/reorders are mirrored, a network failure falls back to local.
 * services/socialService.ts close friends: one-time local -> server migration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
  },
}));

const sync = vi.hoisted(() => ({ on: true }));
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request }));
vi.mock('@/services/socialService', () => ({ canSyncSocialServer: () => sync.on }));

import {
  createHighlight, deleteHighlight, loadHighlights, reorderHighlights, updateHighlight,
} from '@/lib/highlightsService';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const server = (id: string, title: string, position = 0) => ({
  id, userId: 'u', title, coverUrl: null, coverEmoji: '🔥', coverColor: '#111111',
  position, itemCount: 1, items: [], createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  request.mockReset();
  sync.on = true;
});

describe('highlightsService', () => {
  it('stays local and makes no network call when signed out', async () => {
    sync.on = false;
    const h = await createHighlight({ emoji: '✨', label: 'Trip', coverColor: '#222222' });
    expect(h.id.startsWith('hl_')).toBe(true);
    expect((await loadHighlights()).map((x) => x.label)).toEqual(['Trip']);
    await updateHighlight(h.id, { label: 'Trip 2' });
    await reorderHighlights([h.id]);
    await deleteHighlight(h.id);
    expect(await loadHighlights()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('loads the server list and caches it', async () => {
    request.mockResolvedValueOnce([server(UUID_A, 'Drops'), server(UUID_B, 'Sale', 1)]);
    const list = await loadHighlights();
    expect(list.map((h) => [h.id, h.label, h.emoji, h.coverColor])).toEqual([
      [UUID_A, 'Drops', '🔥', '#111111'], [UUID_B, 'Sale', '🔥', '#111111'],
    ]);
    request.mockRejectedValueOnce(new Error('offline'));
    expect((await loadHighlights()).map((h) => h.id)).toEqual([UUID_A, UUID_B]); // cache fallback
  });

  it('uploads local-only highlights once, swapping in the server id', async () => {
    sync.on = false;
    await createHighlight({ emoji: '🌿', label: 'Old local', coverColor: '#333333' });
    sync.on = true;
    request
      .mockResolvedValueOnce([server(UUID_A, 'Remote')])
      .mockResolvedValueOnce(server(UUID_B, 'Old local'));
    const list = await loadHighlights();
    expect(list.map((h) => h.id)).toEqual([UUID_A, UUID_B]);
    const [, post] = request.mock.calls;
    expect(post[0]).toBe('/api/social/highlights');
    expect(JSON.parse(post[1].body)).toMatchObject({ title: 'Old local', coverEmoji: '🌿', coverColor: '#333333' });
    // second load: nothing local-only left to upload
    request.mockResolvedValueOnce([server(UUID_A, 'Remote'), server(UUID_B, 'Old local')]);
    await loadHighlights();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('creates on the server when online and falls back to a local id when it fails', async () => {
    request.mockResolvedValueOnce(server(UUID_A, 'Fresh'));
    const online = await createHighlight({ emoji: '🔥', label: 'Fresh', coverColor: '#111111' });
    expect(online.id).toBe(UUID_A);
    request.mockRejectedValueOnce(new Error('offline'));
    const offline = await createHighlight({ emoji: '🔥', label: 'Later', coverColor: 'rgb(1,2,3)' });
    expect(offline.id.startsWith('hl_')).toBe(true);
  });

  it('mirrors edit, reorder and delete to the server for synced highlights only', async () => {
    request.mockResolvedValueOnce([server(UUID_A, 'A'), server(UUID_B, 'B', 1)]);
    await loadHighlights();
    request.mockResolvedValue({});
    await updateHighlight(UUID_A, { label: 'A2', emoji: '💫' });
    expect(request).toHaveBeenLastCalledWith(`/api/social/highlights/${UUID_A}`, expect.objectContaining({ method: 'PATCH' }), false);
    expect(JSON.parse(request.mock.lastCall![1].body)).toEqual({ title: 'A2', coverEmoji: '💫' });
    await reorderHighlights([UUID_B, UUID_A]);
    const patches = request.mock.calls.filter((c) => JSON.parse(c[1].body ?? '{}').position !== undefined);
    expect(patches.map((c) => [c[0], JSON.parse(c[1].body).position])).toEqual([
      [`/api/social/highlights/${UUID_B}`, 0], [`/api/social/highlights/${UUID_A}`, 1],
    ]);
    await deleteHighlight(UUID_A);
    expect(request).toHaveBeenLastCalledWith(`/api/social/highlights/${UUID_A}`, { method: 'DELETE' }, false);
  });
});
