import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = vi.hoisted(() => [] as Array<(t: string) => void>);
vi.mock('@clerk/expo', () => {
  const getToken = () => new Promise<string>((r) => { tokens.push(r); });
  return { useAuth: () => ({ getToken }) };
});
vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.test', getStoreContext: () => null }));

import { useLiveSocket } from '../useLiveSocket';
import { useSellerSocket } from '../useSellerSocket';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  onclose: unknown = null;
  closed = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send() {}
  close() { this.closed = true; }
}

let tree: ReactTestRenderer | undefined;
beforeEach(() => { tokens.length = 0; FakeSocket.instances = []; (globalThis as any).WebSocket = FakeSocket; });
afterEach(() => { act(() => tree?.unmount()); tree = undefined; delete (globalThis as any).WebSocket; });

const noop = () => {};
const open = () => FakeSocket.instances.filter((s) => !s.closed);

describe('a token that arrives after a restart opens no extra socket (audit)', () => {
  it('useLiveSocket: switching streams mid-token', async () => {
    function Probe({ id }: { id: string }) {
      useLiveSocket({ streamId: id, enabled: true, onEvent: noop, onConnected: noop, onFallback: noop });
      return null;
    }
    await act(async () => { tree = create(<Probe id="s1" />); });
    await act(async () => { tree!.update(<Probe id="s2" />); });
    expect(tokens).toHaveLength(2);
    await act(async () => { tokens[1]('t2'); tokens[0]('t1'); });
    expect(open().map((s) => s.url)).toEqual([expect.stringContaining('streamId=s2')]);
  });

  it('useSellerSocket: blur/focus mid-token', async () => {
    function Probe({ on }: { on: boolean }) {
      useSellerSocket({ enabled: on, onEvent: noop, onConnected: noop, onStatus: noop });
      return null;
    }
    await act(async () => { tree = create(<Probe on />); });
    await act(async () => { tree!.update(<Probe on={false} />); });
    await act(async () => { tree!.update(<Probe on />); });
    expect(tokens).toHaveLength(2);
    await act(async () => { tokens[0]('t1'); tokens[1]('t2'); });
    expect(open()).toHaveLength(1);
    expect(open()[0].url).toContain('token=t2');
  });
});
