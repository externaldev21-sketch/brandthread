import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configListeners: Array<() => void> = [];
let sessionImpl: () => Promise<{ token: string; base: string } | null> = async () => null;

vi.mock('@/lib/serviceConfig', () => ({
  serviceSession: () => sessionImpl(),
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
  close() { this.closed = true; }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('userEvents socket (audit)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeSocket.instances = [];
    configListeners.length = 0;
    (globalThis as any).WebSocket = FakeSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('a failing session lookup is retried instead of becoming an unhandled rejection', async () => {
    let calls = 0;
    sessionImpl = async () => { calls += 1; throw new Error('token store unavailable'); };
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onRejection);
    try {
      const mod = await import('./userEvents');
      const off = mod.subscribeUserEvents(() => {});
      await flush();
      await flush();
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls).toBe(2);
      off();
      await flush();
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('reconnects with the new session when the active account changes', async () => {
    let token = 'tok-a';
    sessionImpl = async () => ({ token, base: 'https://api.example.test' });
    const mod = await import('./userEvents');
    mod.subscribeUserEvents(() => {});
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toContain('token=tok-a');
    FakeSocket.instances[0].onopen?.();

    token = 'tok-b';
    configListeners.forEach((fn) => fn());
    await flush();
    expect(FakeSocket.instances[0].closed).toBe(true);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toContain('token=tok-b');
  });

  it('never opens a socket with a token fetched before the account changed', async () => {
    let token = 'tok-a';
    sessionImpl = () => {
      const t = token;
      return new Promise((resolve) => setTimeout(() => resolve({ token: t, base: 'https://api.example.test' }), 50));
    };
    const mod = await import('./userEvents');
    mod.subscribeUserEvents(() => {});
    // Account switch while the first session lookup is still in flight.
    token = 'tok-b';
    configListeners.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeSocket.instances.map((s) => s.url.split('token=')[1])).toEqual(['tok-b']);
  });
});
