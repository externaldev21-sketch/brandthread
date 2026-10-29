import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../useLiveDirectory', () => ({ getLiveDirectory: () => ({ markEnded: () => {} }) }));

import { useLivePager } from '../useLivePager';
import type { LiveStream, LiveStreamProvider } from '../types';

const stream = (id: string): LiveStream => ({
  id, host: { id: `h-${id}`, name: 'Host', handle: '@h', initials: 'H', avatarColor: '#000', verified: false },
  title: 't', viewerCount: 1, likeCount: 0, startedAt: 0, followedByViewer: false, products: [], pinnedProductId: null,
  topViewers: [], video: { kind: 'rtc', vendor: 'agora' },
});

const provider: LiveStreamProvider = {
  id: 'api',
  listLive: async () => [stream('a'), stream('b')],
  listUpcoming: async () => [], listSuggestedCreators: async () => [],
  join: async () => ({ ok: true, recentChat: [] }), leave: async () => {},
  subscribe: () => () => {}, sendChat: async () => ({ id: 'm', username: 'u', text: 't', at: 0 }),
  sendLike: async () => {}, setReminder: async () => {}, setFollowing: async () => {},
  start: async () => ({ streamId: 'x' }), stop: async () => {},
};

let tree: ReactTestRenderer | undefined;
afterEach(() => { vi.useRealTimers(); tree = undefined; });

describe('useLivePager timers (audit)', () => {
  it('clears a pending exit-animation timer when the pager unmounts', async () => {
    vi.useFakeTimers();
    let pager: ReturnType<typeof useLivePager> | null = null;
    function Probe() { pager = useLivePager(provider, {}); return null; }
    await act(async () => { tree = create(<Probe />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(pager!.streams).toHaveLength(2);
    await act(async () => { pager!.removeStream('a', 'Host'); });
    act(() => tree!.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
