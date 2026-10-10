import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    removeItem: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
  },
}));

import { ApiError } from './networkNotice';
import {
  __resetMessageOutboxForTests,
  MAX_SERVER_ATTEMPTS,
  OutboxAccountMismatchError,
  type OutboxEntry,
  type OutboxEvent,
  clientIdFromOutboxMessageId,
  createClientMessageId,
  discardOutboxMessage,
  enqueueOutboxMessage,
  flushAllOutboxes,
  flushOutbox,
  getOutboxSnapshot,
  isOutboxMessageId,
  listOutboxConversations,
  loadOutbox,
  mergeOutboxIntoThread,
  outboxEntryToMessage,
  outboxMessageId,
  outboxStorageKey,
  reconcileOutbox,
  retryOutboxMessage,
  subscribeOutboxEvents,
  withoutDelivered,
} from './messageOutbox';

const offline = () => new Error('Network request failed');
const serverDown = () => new ApiError(503, '{}');
const rejected = () => new ApiError(422, JSON.stringify({ error: 'flagged', code: 'MODERATED' }));

function texts(entries: OutboxEntry[]): string[] {
  return entries.map((e) => e.text);
}

describe('message outbox — pure helpers', () => {
  beforeEach(() => __resetMessageOutboxForTests());

  it('creates ids the server accepts as client message ids, all distinct', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = createClientMessageId(1_760_000_000_000 + i);
      expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
    // Same millisecond, same random value: the counter still separates them.
    expect(createClientMessageId(1, () => 0.5)).not.toBe(createClientMessageId(1, () => 0.5));
  });

  it('round-trips the thread id of a queued message', () => {
    const id = outboxMessageId('cm_abc_123');
    expect(isOutboxMessageId(id)).toBe(true);
    expect(isOutboxMessageId('3f2c-uuid')).toBe(false);
    expect(isOutboxMessageId(undefined)).toBe(false);
    expect(clientIdFromOutboxMessageId(id)).toBe('cm_abc_123');
    expect(clientIdFromOutboxMessageId('local-1')).toBeNull();
  });

  it('shows a queued message once the server has it — as the server copy, never twice', () => {
    const server = [{ id: 's1', clientMessageId: 'cm_a' }, { id: 's2' }];
    const pending = [
      { id: outboxMessageId('cm_a'), clientMessageId: 'cm_a' },
      { id: outboxMessageId('cm_b'), clientMessageId: 'cm_b' },
    ];
    expect(mergeOutboxIntoThread(server, pending).map((m) => m.id)).toEqual(['s1', 's2', outboxMessageId('cm_b')]);
    expect(mergeOutboxIntoThread(server, [])).toBe(server);
  });

  it('renders a queued entry with the chat’s existing sending / failed states', () => {
    const entry: OutboxEntry = {
      clientMessageId: 'cm_abc_123', conversationId: 'c', text: 'hi', replyToId: 'm1', replyPreview: 'q',
      createdAt: 42, attempts: 0, status: 'sending',
    };
    const author = { fromId: 'me', fromName: 'You', fromInitials: 'Y', fromColor: '#000' };
    expect(outboxEntryToMessage(entry, author)).toMatchObject({
      id: outboxMessageId('cm_abc_123'), conversationId: 'c', fromId: 'me', text: 'hi', replyToId: 'm1',
      replyPreview: 'q', reactions: [], status: 'sending', ts: 42, deletedForMe: false, clientMessageId: 'cm_abc_123',
    });
    expect(outboxEntryToMessage({ ...entry, status: 'failed' }, author).status).toBe('failed');
  });

  it('drops delivered entries by client message id', () => {
    const entries = [
      { clientMessageId: 'cm_a' },
      { clientMessageId: 'cm_b' },
    ] as OutboxEntry[];
    expect(withoutDelivered(entries, [{ clientMessageId: 'cm_b' }, {}]).map((e) => e.clientMessageId)).toEqual(['cm_a']);
  });
});

describe('message outbox — queue', () => {
  let events: OutboxEvent[];

  beforeEach(() => {
    store.clear();
    __resetMessageOutboxForTests();
    events = [];
    subscribeOutboxEvents((e) => events.push(e));
  });

  it('persists per user and conversation, and survives a cold start', async () => {
    await enqueueOutboxMessage('user-a', 'conv-1', { text: 'one' });
    await enqueueOutboxMessage('user-a', 'conv-1', { text: 'two', replyToId: 'm-9', replyPreview: 'hi' });
    expect(store.has(outboxStorageKey('user-a', 'conv-1'))).toBe(true);

    __resetMessageOutboxForTests();
    const reloaded = await loadOutbox('user-a', 'conv-1');
    expect(texts(reloaded)).toEqual(['one', 'two']);
    expect(reloaded[1]).toMatchObject({ replyToId: 'm-9', replyPreview: 'hi', status: 'sending', attempts: 0 });
    expect(await listOutboxConversations('user-a')).toEqual(['conv-1']);
  });

  it('never shows or sends one account’s queue for another account', async () => {
    await enqueueOutboxMessage('user-a', 'conv-1', { text: 'from a' });
    expect(await loadOutbox('user-b', 'conv-1')).toEqual([]);
    expect(await listOutboxConversations('user-b')).toEqual([]);

    const send = vi.fn(async () => ({}));
    await flushAllOutboxes('user-b', send);
    expect(send).not.toHaveBeenCalled();
    expect(texts(getOutboxSnapshot('user-a', 'conv-1'))).toEqual(['from a']);
  });

  it('sends queued messages oldest first and empties the queue', async () => {
    await enqueueOutboxMessage('u', 'c', { text: '1' });
    await enqueueOutboxMessage('u', 'c', { text: '2' });
    await enqueueOutboxMessage('u', 'c', { text: '3' });
    const sent: string[] = [];
    await flushOutbox('u', 'c', async (e) => { sent.push(e.text); return { id: `s-${e.text}` }; });
    expect(sent).toEqual(['1', '2', '3']);
    expect(getOutboxSnapshot('u', 'c')).toEqual([]);
    expect(store.has(outboxStorageKey('u', 'c'))).toBe(false);
    expect(await listOutboxConversations('u')).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(['sent', 'sent', 'sent']);
  });

  it('stops at the first offline failure so later messages can never overtake it', async () => {
    await enqueueOutboxMessage('u', 'c', { text: '1' });
    await enqueueOutboxMessage('u', 'c', { text: '2' });
    await enqueueOutboxMessage('u', 'c', { text: '3' });
    const sent: string[] = [];
    let online = false;
    const send = async (e: OutboxEntry) => {
      if (e.text === '2' && !online) throw offline();
      sent.push(e.text);
      return {};
    };
    await flushOutbox('u', 'c', send);
    expect(sent).toEqual(['1']);
    const left = getOutboxSnapshot('u', 'c');
    expect(texts(left)).toEqual(['2', '3']);
    // Offline attempts don't count toward giving up.
    expect(left.every((e) => e.status === 'sending' && e.attempts === 0)).toBe(true);

    online = true;
    await flushOutbox('u', 'c', send);
    expect(sent).toEqual(['1', '2', '3']);
    expect(getOutboxSnapshot('u', 'c')).toEqual([]);
  });

  it('retries server failures a bounded number of times, then waits for Tap to retry', async () => {
    await enqueueOutboxMessage('u', 'c', { text: 'stuck' });
    await enqueueOutboxMessage('u', 'c', { text: 'next' });
    let down = true;
    const sent: string[] = [];
    const send = async (e: OutboxEntry) => {
      if (e.text === 'stuck' && down) throw serverDown();
      sent.push(e.text);
      return {};
    };
    for (let i = 0; i < MAX_SERVER_ATTEMPTS - 1; i += 1) {
      await flushOutbox('u', 'c', send);
      expect(getOutboxSnapshot('u', 'c')[0]).toMatchObject({ status: 'sending', attempts: i + 1 });
      expect(sent).toEqual([]);
    }
    await flushOutbox('u', 'c', send);
    // Gave up on its own: failed (the chat's existing retry state); the next message is no longer held back.
    expect(getOutboxSnapshot('u', 'c').map((e) => [e.text, e.status])).toEqual([['stuck', 'failed']]);
    expect(sent).toEqual(['next']);

    // A failed entry is skipped by later passes until the user retries it.
    down = false;
    await flushOutbox('u', 'c', send);
    expect(sent).toEqual(['next']);
    const [failed] = getOutboxSnapshot('u', 'c');
    expect(await retryOutboxMessage('u', 'c', failed.clientMessageId)).toBe(true);
    expect(getOutboxSnapshot('u', 'c')[0]).toMatchObject({ status: 'sending', attempts: 0 });
    await flushOutbox('u', 'c', send);
    expect(sent).toEqual(['next', 'stuck']);
    expect(await retryOutboxMessage('u', 'c', 'cm_missing_000')).toBe(false);
  });

  it('drops a real rejection and reports it so the screen can restore the composer', async () => {
    await enqueueOutboxMessage('u', 'c', { text: 'bad' });
    await enqueueOutboxMessage('u', 'c', { text: 'good' });
    const send = async (e: OutboxEntry) => {
      if (e.text === 'bad') throw rejected();
      return { id: 's-good' };
    };
    await flushOutbox('u', 'c', send);
    expect(getOutboxSnapshot('u', 'c')).toEqual([]);
    expect(events.map((e) => [e.type, e.entry.text])).toEqual([['rejected', 'bad'], ['sent', 'good']]);
    const rejection = events[0];
    expect(rejection.type === 'rejected' && rejection.error).toBeInstanceOf(ApiError);
  });

  it('keeps a queue that belongs to a different signed-in account without counting an attempt', async () => {
    await enqueueOutboxMessage('u', 'c', { text: 'mine' });
    await flushOutbox('u', 'c', async () => { throw new OutboxAccountMismatchError(); });
    expect(getOutboxSnapshot('u', 'c')[0]).toMatchObject({ status: 'sending', attempts: 0 });
  });

  it('sends every message once even when flushes overlap, using the same client id each attempt', async () => {
    await enqueueOutboxMessage('u', 'c', { text: '1' });
    const calls: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const send = async (e: OutboxEntry) => {
      calls.push(e.clientMessageId);
      await gate;
      return {};
    };
    const first = flushOutbox('u', 'c', send);
    const second = flushOutbox('u', 'c', send);
    // Queued while the first pass is in flight: picked up by the follow-up pass.
    await enqueueOutboxMessage('u', 'c', { text: '2' });
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(2);
    expect(new Set(calls).size).toBe(2);
    expect(getOutboxSnapshot('u', 'c')).toEqual([]);
  });

  it('retries with the same client message id so the server can dedupe', async () => {
    const entry = await enqueueOutboxMessage('u', 'c', { text: 'x' });
    const ids: string[] = [];
    let fail = true;
    const send = async (e: OutboxEntry) => {
      ids.push(e.clientMessageId);
      if (fail) { fail = false; throw offline(); }
      return {};
    };
    await flushOutbox('u', 'c', send);
    await flushOutbox('u', 'c', send);
    expect(ids).toEqual([entry.clientMessageId, entry.clientMessageId]);
  });

  it('ignores a repeat enqueue of the same client id', async () => {
    await enqueueOutboxMessage('u', 'c', { text: 'x' }, { clientMessageId: 'cm_fixed_0001' });
    await enqueueOutboxMessage('u', 'c', { text: 'x' }, { clientMessageId: 'cm_fixed_0001' });
    expect(getOutboxSnapshot('u', 'c')).toHaveLength(1);
  });

  it('reconciles with the server list: a send whose response was lost is not sent again', async () => {
    const a = await enqueueOutboxMessage('u', 'c', { text: 'landed' });
    await enqueueOutboxMessage('u', 'c', { text: 'pending' });
    await reconcileOutbox('u', 'c', [{ clientMessageId: a.clientMessageId }]);
    expect(texts(getOutboxSnapshot('u', 'c'))).toEqual(['pending']);
  });

  it('discards a single entry', async () => {
    const a = await enqueueOutboxMessage('u', 'c', { text: 'a' });
    await enqueueOutboxMessage('u', 'c', { text: 'b' });
    await discardOutboxMessage('u', 'c', a.clientMessageId);
    expect(texts(getOutboxSnapshot('u', 'c'))).toEqual(['b']);
  });

  it('flushes every conversation that has queued messages', async () => {
    await enqueueOutboxMessage('u', 'c1', { text: 'a' });
    await enqueueOutboxMessage('u', 'c2', { text: 'b' });
    expect((await listOutboxConversations('u')).sort()).toEqual(['c1', 'c2']);
    const sent: string[] = [];
    await flushAllOutboxes('u', async (e) => { sent.push(`${e.conversationId}:${e.text}`); return {}; });
    expect(sent.sort()).toEqual(['c1:a', 'c2:b']);
    expect(await listOutboxConversations('u')).toEqual([]);
  });
});
