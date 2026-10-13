import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest, store } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach((k) => store.delete(k)); }),
  },
}));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false,
  isPreviewDemoMode: () => false,
}));

import type { Message } from './socialTypes';
import {
  LOCAL_MESSAGE_ID_PREFIX,
  clearSocialCache,
  getChatDraft,
  getMessages,
  initSocialService,
  mergeUnsentMessages,
  retryMessage,
  sendMessageWithOutbox,
  setChatDraft,
} from './socialService';

function msg(id: string, ts: number, extra: Partial<Message> = {}): Message {
  return {
    id, conversationId: 'c1', fromId: 'me', fromName: 'You', fromInitials: 'Y', fromColor: '#000',
    text: id, reactions: [], status: 'sent', ts, deletedForMe: false, ...extra,
  };
}

describe('message outbox', () => {
  beforeEach(() => {
    store.clear();
    serviceRequest.mockReset();
    initSocialService('user-1');
  });

  it('merges unsent local messages into server results in time order, without duplicates', () => {
    const remote = [msg('a', 1), msg('b', 3)];
    const local = msg(`${LOCAL_MESSAGE_ID_PREFIX}x`, 2, { status: 'failed' });
    expect(mergeUnsentMessages(remote, [local]).map((m) => m.id)).toEqual(['a', local.id, 'b']);
    expect(mergeUnsentMessages(remote, [msg('a', 1)]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('keeps a failed send through a refresh, then retry replaces it with the server copy', async () => {
    const local = msg(`${LOCAL_MESSAGE_ID_PREFIX}1`, 5, { text: 'hello' });
    serviceRequest.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(sendMessageWithOutbox('c1', local)).rejects.toThrow();

    serviceRequest.mockResolvedValueOnce([msg('srv-1', 1)]);
    const afterRefresh = await getMessages('c1');
    expect(afterRefresh.map((m) => [m.id, m.status])).toEqual([['srv-1', 'sent'], [local.id, 'failed']]);

    serviceRequest.mockResolvedValueOnce(msg('srv-2', 6, { text: 'hello' }));
    await retryMessage('c1', local.id);
    serviceRequest.mockResolvedValueOnce([msg('srv-1', 1), msg('srv-2', 6, { text: 'hello' })]);
    const final = await getMessages('c1');
    expect(final.map((m) => m.id)).toEqual(['srv-1', 'srv-2']);
  });

  it('replaces the sending copy with the server message on success', async () => {
    const local = msg(`${LOCAL_MESSAGE_ID_PREFIX}2`, 5);
    serviceRequest.mockResolvedValueOnce(msg('srv-9', 5));
    await sendMessageWithOutbox('c1', local);
    serviceRequest.mockResolvedValueOnce([msg('srv-9', 5)]);
    expect((await getMessages('c1')).map((m) => m.id)).toEqual(['srv-9']);
  });
});

describe('chat drafts', () => {
  beforeEach(() => {
    store.clear();
    initSocialService('user-1');
  });

  it('saves, restores and clears a draft per conversation', async () => {
    await setChatDraft('c1', 'half a thought');
    await setChatDraft('c2', 'other chat');
    expect(await getChatDraft('c1')).toBe('half a thought');
    expect(await getChatDraft('c2')).toBe('other chat');
    await setChatDraft('c1', '   ');
    expect(await getChatDraft('c1')).toBe('');
  });

  it('is per account and leaves with the account', async () => {
    await setChatDraft('c1', 'mine');
    initSocialService('user-2');
    expect(await getChatDraft('c1')).toBe('');
    await clearSocialCache('user-1');
    initSocialService('user-1');
    expect(await getChatDraft('c1')).toBe('');
  });
});
