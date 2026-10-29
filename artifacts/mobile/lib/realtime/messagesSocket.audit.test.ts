import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configListeners: Array<() => void> = [];
let token: string | null = 'tok-a';

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('@/lib/serviceConfig', () => ({
  // Resolves later with the token that was current when it was asked for.
  getServiceToken: () => {
    const t = token;
    return new Promise((resolve) => setTimeout(() => resolve(t), 50));
  },
  onServicesConfigured: (fn: () => void) => { configListeners.push(fn); return () => {}; },
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send() {}
  close() { this.closed = true; }
}

process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';

describe('messagesSocket account switch during connect (audit)', () => {
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

  it('drops a token fetched for the previous account and connects with the new one', async () => {
    const mod = await import('./messagesSocket');
    mod.subscribeRealtime(() => {});
    // The first token lookup is still in flight when the account changes.
    token = 'tok-b';
    configListeners.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeSocket.instances.map((s) => s.url.split('token=')[1])).toEqual(['tok-b']);
  });
});
