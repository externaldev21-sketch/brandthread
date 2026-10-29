import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const held = vi.hoisted(() => ({ auction: new Map<string, (v: unknown) => void>(), pinned: new Map<string, (v: unknown) => void>() }));
vi.mock('@/services/liveAuctionsService', () => ({
  fetchActiveAuction: (streamId: string) => new Promise((r) => { held.auction.set(streamId, r); }),
  placeLiveBid: vi.fn(),
}));
vi.mock('@/lib/safety', () => ({ apiErrorMessage: () => 'x' }));
const api = vi.hoisted(() => ({
  liveMod: { pinned: (streamId: string) => new Promise((r) => { held.pinned.set(streamId, r); }) },
  liveCohost: { list: async () => ({ cohosts: [] }) },
}));
vi.mock('@/lib/api', () => ({ useApi: () => api }));

import { useLiveAuction } from '../useLiveAuction';
import { useLiveModeration } from '../useLiveModeration';

const auctionFor = (streamId: string) => ({
  id: `auc-${streamId}`, streamId, sellerId: 's', productId: 'p', variantId: null, productName: 'Coat', imageUri: null,
  startingBidCents: 100, currentBidCents: null, nextMinBidCents: 100, incrementCents: 100, bidCount: 0,
  leaderUserId: null, leaderName: null, suddenDeath: false, endsAt: new Date(Date.now() + 60_000).toISOString(),
  serverNow: new Date().toISOString(), status: 'open', winnerName: null,
});

let tree: ReactTestRenderer | undefined;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; held.auction.clear(); held.pinned.clear(); });

describe('live hooks ignore responses for a stream the viewer swiped away from (audit)', () => {
  it('useLiveAuction', async () => {
    let state: ReturnType<typeof useLiveAuction> | null = null;
    function Probe({ id }: { id: string }) { state = useLiveAuction(id, { enabled: true }); return null; }
    await act(async () => { tree = create(<Probe id="s1" />); });
    await act(async () => { tree!.update(<Probe id="s2" />); });
    await act(async () => { held.auction.get('s1')!({ enabled: true, auction: auctionFor('s1') }); });
    expect(state!.auction).toBeNull();
    await act(async () => { held.auction.get('s2')!({ enabled: true, auction: auctionFor('s2') }); });
    expect(state!.auction?.streamId).toBe('s2');
  });

  it('useLiveModeration', async () => {
    let state: ReturnType<typeof useLiveModeration> | null = null;
    function Probe({ id }: { id: string }) { state = useLiveModeration(id); return null; }
    await act(async () => { tree = create(<Probe id="s1" />); });
    await act(async () => { state!.refresh(); });
    await act(async () => { tree!.update(<Probe id="s2" />); });
    await act(async () => { held.pinned.get('s1')!({ pinnedComment: { id: 'c1', display_name: 'A', message: 'old room' } }); });
    expect(state!.pinned).toBeNull();
  });
});
