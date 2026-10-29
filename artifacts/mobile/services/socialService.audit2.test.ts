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
  initSocialService,
  retryMessage,
  sendMessageWithOutbox,
} from './socialService';

function msg(id: string, ts: number, extra: Partial<Message> = {}): Message {
  return {
    id, conversationId: 'c1', fromId: 'me', fromName: 'You', fromInitials: 'Y', fromColor: '#000',
    text: id, reactions: [], status: 'sent', ts, deletedForMe: false, ...extra,
  };
}

const sentBody = (call: number) => JSON.parse(serviceRequest.mock.calls[call][1].body);

describe('outbox sends are idempotent (clientMessageId)', () => {
  beforeEach(() => {
    store.clear();
    serviceRequest.mockReset();
    initSocialService('user-1');
  });

  it('sends the same server-valid clientMessageId on the first attempt and on retry', async () => {
    const local = msg(`${LOCAL_MESSAGE_ID_PREFIX}abc123`, 5, { text: 'hello' });
    serviceRequest.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(sendMessageWithOutbox('c1', local)).rejects.toThrow();
    serviceRequest.mockResolvedValueOnce(msg('srv-1', 5, { text: 'hello' }));
    await retryMessage('c1', local.id);

    const first = sentBody(0).clientMessageId;
    const retry = sentBody(1).clientMessageId;
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(retry).toBe(first);
  });

  it('reuses an explicit clientMessageId on the message', async () => {
    const local = msg(`${LOCAL_MESSAGE_ID_PREFIX}1`, 5, { clientMessageId: 'cmid-12345678' });
    serviceRequest.mockResolvedValueOnce(msg('srv-2', 5));
    await sendMessageWithOutbox('c1', local);
    expect(sentBody(0).clientMessageId).toBe('cmid-12345678');
  });
});
