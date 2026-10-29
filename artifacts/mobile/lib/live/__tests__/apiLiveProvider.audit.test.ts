import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '../types';

const comment = { id: 'c1', user_id: 'u1', display_name: 'Ana', message: 'love it', created_at: new Date(Date.now() + 1000).toISOString() };
const pending = vi.hoisted(() => ({ release: null as null | (() => void) }));

vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.example.test' }));
vi.mock('@/services/socialService', () => ({ setSellerFollowing: async () => {} }));
vi.mock('@/lib/serviceConfig', () => ({
  getServiceToken: async () => 'tok',
  hasServiceToken: async () => true,
  serviceRequest: async (path: string) => {
    if (path.includes('/comments')) {
      // Held until the test releases it, so the socket can deliver first.
      await new Promise<void>((r) => { pending.release = r; });
      return { comments: [comment] };
    }
    if (path.includes('/activity')) return { activity: [] };
    return { stream: { id: 's1', status: 'live', viewer_count: 1, product_tags: [] } };
  },
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send() {}
  close() {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('api live provider chat de-duplication (audit)', () => {
  beforeEach(() => { FakeSocket.instances = []; (globalThis as any).WebSocket = FakeSocket; });
  afterEach(() => { delete (globalThis as any).WebSocket; });

  it('shows a comment once when the socket delivers it while a poll for it is in flight', async () => {
    const { createApiLiveProvider } = await import('../apiLiveProvider');
    const events: LiveEvent[] = [];
    const off = createApiLiveProvider().subscribe('s1', (e) => events.push(e));
    await flush();
    const ws = FakeSocket.instances[0];
    ws.onmessage!({ data: JSON.stringify({ type: 'comment', comment }) });
    pending.release!();
    await flush();
    off();
    const lines = events.flatMap((e) => (e.type === 'chat' ? e.messages : []));
    expect(lines.map((m) => m.id)).toEqual(['c1']);
  });
});
