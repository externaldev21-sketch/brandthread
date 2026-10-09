import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configListeners: Array<() => void> = [];
let token: string | null = 'tok-a';

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('@/lib/serviceConfig', () => ({
  getServiceToken: async () => token,
  onServicesConfigured: (fn: () => void) => { configListeners.push(fn); return () => {}; },
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  emit(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
  drop() { this.onclose?.(); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';

describe('messagesSocket helpers', () => {
  it('backs off exponentially and caps at 30s', async () => {
    const { reconnectDelayMs } = await import('./messagesSocket');
    expect([1, 2, 3, 4].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(reconnectDelayMs(20)).toBe(30_000);
    expect(reconnectDelayMs(0)).toBe(1000);
  });

  it('builds a ws(s) URL with the token encoded', async () => {
    const { messagesSocketUrl } = await import('./messagesSocket');
    expect(messagesSocketUrl('https://api.x.test/', 'a b')).toBe('wss://api.x.test/ws/messages?token=a%20b');
    expect(messagesSocketUrl('http://localhost:8080', 't')).toBe('ws://localhost:8080/ws/messages?token=t');
  });

  it('ignores malformed frames', async () => {
    const { parseRealtimeEvent } = await import('./messagesSocket');
    expect(parseRealtimeEvent('nope')).toBeNull();
    expect(parseRealtimeEvent('{"x":1}')).toBeNull();
    expect(parseRealtimeEvent('{"type":"badges.changed"}')).toEqual({ type: 'badges.changed' });
  });
});

describe('messagesSocket connection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeSocket.instances = [];
    configListeners.length = 0;
    token = 'tok-a';
    (globalThis as any).WebSocket = FakeSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('connects on first subscriber, dispatches events and reports status', async () => {
    const mod = await import('./messagesSocket');
    const events: unknown[] = [];
    const statuses: boolean[] = [];
    mod.subscribeRealtimeStatus((c) => statuses.push(c));
    mod.subscribeRealtime((e) => events.push(e));
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe('wss://api.example.test/ws/messages?token=tok-a');
    FakeSocket.instances[0].open();
    expect(mod.isRealtimeConnected()).toBe(true);
    FakeSocket.instances[0].emit({ type: 'typing', conversationId: 'c1', userId: 'u2', typing: true });
    expect(events).toEqual([{ type: 'typing', conversationId: 'c1', userId: 'u2', typing: true }]);
    expect(statuses).toEqual([true]);
  });

  it('reconnects after a drop and falls back to disconnected meanwhile', async () => {
    const mod = await import('./messagesSocket');
    mod.subscribeRealtime(() => {});
    await flush();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop();
    expect(mod.isRealtimeConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('reconnects with the new token when the active account changes', async () => {
    const mod = await import('./messagesSocket');
    mod.subscribeRealtime(() => {});
    await flush();
    FakeSocket.instances[0].open();
    token = 'tok-b';
    configListeners.forEach((fn) => fn());
    await flush();
    expect(FakeSocket.instances[0].closed).toBe(true);
    expect(FakeSocket.instances[1].url).toContain('token=tok-b');
  });

  it('never connects signed out (the signed-out preview has no session token)', async () => {
    token = null;
    const mod = await import('./messagesSocket');
    mod.subscribeRealtime(() => {});
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('closes after the last subscriber leaves (with a short grace period)', async () => {
    const mod = await import('./messagesSocket');
    const off = mod.subscribeRealtime(() => {});
    await flush();
    FakeSocket.instances[0].open();
    off();
    expect(FakeSocket.instances[0].closed).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(FakeSocket.instances[0].closed).toBe(true);
  });
});

describe('conversation helpers', () => {
  it('merges an incoming message by id and keeps time order', async () => {
    vi.doMock('./messagesSocket', () => ({ isRealtimeConnected: () => false, subscribeRealtime: () => () => {}, subscribeRealtimeStatus: () => () => {} }));
    const { mergeIncomingMessage } = await import('./conversationRealtime');
    const a = { id: 'a', ts: 1, text: 'a' };
    const b = { id: 'b', ts: 3, text: 'b' };
    expect(mergeIncomingMessage([a], b).map((m) => m.id)).toEqual(['a', 'b']);
    expect(mergeIncomingMessage([a, b], { id: 'c', ts: 2, text: 'c' }).map((m) => m.id)).toEqual(['a', 'c', 'b']);
    // The sender's own echo replaces the optimistic copy instead of duplicating.
    expect(mergeIncomingMessage([a, b], { id: 'b', ts: 3, text: 'b2' })).toEqual([a, { id: 'b', ts: 3, text: 'b2' }]);
  });

  it('marks only the other side’s unread messages as read', async () => {
    const { applyReadReceipt } = await import('./conversationRealtime');
    const list = [
      { id: '1', fromId: 'me', status: 'sent' },
      { id: '2', fromId: 'reader', status: 'sent' },
      { id: '3', fromId: 'me', status: 'read', readAt: 'earlier' },
    ];
    const next = applyReadReceipt(list, 'reader', 'now');
    expect(next[0]).toMatchObject({ readAt: 'now', status: 'read' });
    expect(next[1]).toEqual(list[1]);
    expect(next[2].readAt).toBe('earlier');
    expect(applyReadReceipt(next, 'reader', 'later')).toBe(next);
  });
});
