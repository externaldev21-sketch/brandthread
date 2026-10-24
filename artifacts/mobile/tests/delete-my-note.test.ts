/**
 * socialService.deleteMyNote(): signed in → DELETE /api/social/notes/me;
 * signed-out dev preview (no backend) → clears the in-memory preview note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
    multiGet: () => Promise.resolve([]),
    multiSet: () => Promise.resolve(),
  },
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request, hasServiceToken: () => true }));
// __DEV__ is false under vitest, which strips the preview gate; force it on.
const preview = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/lib/previewNotes', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/previewNotes')>(),
  isPreviewNotesEnabled: () => preview.enabled,
}));

import { deleteMyNote, initSocialService } from '@/services/socialService';
import { clearPreviewMyNote, getPreviewMyNote, postPreviewNote } from '@/lib/previewNotes';

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
  clearPreviewMyNote();
});

describe('deleteMyNote', () => {
  it('signed in: calls DELETE /api/social/notes/me', async () => {
    initSocialService('user_1');
    await deleteMyNote();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/api/social/notes/me');
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('signed-out preview: clears the local preview note without a network call', async () => {
    initSocialService(null);
    postPreviewNote('at the thrift store');
    expect(getPreviewMyNote()?.text).toBe('at the thrift store');
    await deleteMyNote();
    expect(getPreviewMyNote()).toBeNull();
    // Idempotent.
    await deleteMyNote();
    expect(request).not.toHaveBeenCalled();
  });

  it('signed out outside the preview: still goes to the server', async () => {
    preview.enabled = false;
    initSocialService(null);
    await deleteMyNote();
    expect(request.mock.calls[0][0]).toBe('/api/social/notes/me');
    preview.enabled = true;
  });
});
