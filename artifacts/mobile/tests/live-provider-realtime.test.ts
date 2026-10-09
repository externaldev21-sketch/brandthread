/**
 * The API live provider's `subscribe` runs on the stream's `/ws/live` room:
 * chat / viewer counts / pinned product arrive over the socket, the 3s HTTP
 * poll stands down while the socket is up, and comes back when it drops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '../lib/live/types';

const requests: string[] = [];
let token: string | null = 'tok';

vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.example.test' }));
vi.mock('@/services/socialService', () => ({ setSellerFollowing: async () => {} }));
vi.mock('@/lib/serviceConfig', () => ({
  getServiceToken: async () => token,
  serviceRequest: async (path: string) => {
    requests.push(path);
    if (path.includes('/comments')) return { comments: [] };
    return { stream: { id: 's1', status: 'live', viewer_count: 4, product_tags: [] } };
  },
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('api live provider realtime subscribe', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    requests.length = 0;
    token = 'tok';
    FakeSocket.instances = [];
    (globalThis as any).WebSocket = FakeSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  async function subscribe() {
    const { createApiLiveProvider } = await import('../lib/live/apiLiveProvider');
    const events: LiveEvent[] = [];
    const off = createApiLiveProvider().subscribe('s1', (e) => events.push(e));
    await flush();
    return { events, off, ws: FakeSocket.instances[0] };
  }

  it('joins the stream room as a viewer with the session token', async () => {
    const { ws, off } = await subscribe();
    expect(ws.url).toBe('wss://api.example.test/ws/live?streamId=s1&token=tok');
    off();
    expect(ws.closed).toBe(true);
  });

  it('delivers chat, viewer counts, pinned product and the end over the socket, without duplicates', async () => {
    const { ws, events, off } = await subscribe();
    ws.onopen!();
    const comment = { id: 'c1', user_id: 'u1', display_name: 'Ana', message: 'love it', created_at: new Date().toISOString() };
    ws.onmessage!({ data: JSON.stringify({ type: 'comment', comment }) });
    ws.onmessage!({ data: JSON.stringify({ type: 'comment', comment }) });
    ws.onmessage!({ data: JSON.stringify({ type: 'viewerCount', count: 12 }) });
    ws.onmessage!({ data: JSON.stringify({ type: 'pinned', productId: 'p9' }) });
    ws.onmessage!({ data: JSON.stringify({ type: 'ended' }) });
    const chat = events.filter((e) => e.type === 'chat');
    expect(chat).toHaveLength(1);
    expect((chat[0] as any).messages[0]).toMatchObject({ id: 'c1', username: 'Ana', text: 'love it' });
    expect(events).toContainEqual({ type: 'viewers', streamId: 's1', viewerCount: 12 });
    expect(events).toContainEqual({ type: 'pinned', streamId: 's1', productId: 'p9' });
    expect(events).toContainEqual({ type: 'ended', streamId: 's1' });
    off();
  });

  it('stops the 3s poll while connected and resumes it when the socket drops', async () => {
    const { ws, off } = await subscribe();
    ws.onopen!();
    await flush();
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(requests).toHaveLength(0); // only the 15s safety poll remains

    ws.onclose!({ code: 1006 });
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(3_100);
    expect(requests.some((p) => p.includes('/comments'))).toBe(true);
    off();
  });

  it('sends the presence heartbeat while connected', async () => {
    const { ws, off } = await subscribe();
    ws.onopen!();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ws.sent).toContain(JSON.stringify({ type: 'heartbeat' }));
    off();
  });

  it('keeps polling and never opens a socket signed out', async () => {
    token = null;
    const { off } = await subscribe();
    expect(FakeSocket.instances).toHaveLength(0);
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(3_100);
    expect(requests.length).toBeGreaterThan(0);
    off();
  });
});
