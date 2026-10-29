import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, serviceRequest } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false, isSellerDevPreview: () => false, isPreviewDemoMode: () => false,
}));

import {
  addReaction, cacheStoriesForViewer, deleteNotification, getStories, initSocialService, socialKeysForUser,
} from './socialService';
import type { Message, Story } from './socialTypes';

const USER = 'user_audit_1';

function call(i: number) {
  const [path, init] = serviceRequest.mock.calls[i] ?? [];
  return { path, method: (init?.method as string | undefined) ?? 'GET' };
}

describe('socialService (audit)', () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    initSocialService(USER);
  });

  it('deleteNotification throws when the server delete fails (the screen puts the row back)', async () => {
    serviceRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new Error('offline');
      return path === '/api/buyer/notifications' ? [{ id: 'n1' }] : {};
    });
    await expect(deleteNotification('n1')).rejects.toThrow('offline');
  });

  it("re-tapping my own server reaction removes it (DELETE), not re-PUT", async () => {
    const message: Message = {
      id: 'm1', conversationId: 'c1', fromId: 'other', fromName: 'Ana', fromInitials: 'A', fromColor: '#000',
      text: 'hi', status: 'sent', ts: 1, deletedForMe: false,
      // GET /api/conversations/:id/messages reaction shape: userId / reactionType, no fromId.
      reactions: [{ userId: USER, userName: 'Me', reactionType: 'like' } as unknown as Message['reactions'][number]],
    };
    storage.set(socialKeysForUser(USER).messages('c1'), JSON.stringify([message]));
    serviceRequest.mockResolvedValue({ ok: true });
    await addReaction('c1', 'm1', 'like');
    expect(call(0)).toEqual({ path: '/api/conversations/c1/messages/m1/reactions', method: 'DELETE' });
  });

  it('records when a story sticker state reached the device, for countdown clock offsets', async () => {
    const now = Date.now();
    const story = {
      id: 's1', expiresAt: now + 3_600_000, media: [],
      stickerState: { serverNow: now - 5_000, polls: {}, questions: {}, products: {}, countdowns: {} },
    } as unknown as Story;
    await cacheStoriesForViewer([story]);
    const [cached] = await getStories();
    expect(typeof cached.stickerState?.receivedAt).toBe('number');
    expect(cached.stickerState!.receivedAt!).toBeGreaterThanOrEqual(now);
  });
});
