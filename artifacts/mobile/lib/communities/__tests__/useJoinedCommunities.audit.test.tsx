import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const held = vi.hoisted(() => new Map<string, (rows: unknown[]) => void>());
const apis = vi.hoisted(() => {
  const make = (user: string) => ({ communities: { mine: () => new Promise((r) => { held.set(user, r as never); }) } });
  return { a: make('a'), b: make('b'), current: 'a' as 'a' | 'b' };
});
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true, getToken: async () => 't', userId: apis.current }) }));
vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.test', useApi: () => apis[apis.current] }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));
vi.mock('@/lib/stickyState', async () => {
  const { useState } = await import('react');
  return { useStickyState: <T,>(_k: string, initial: T) => { const [v, set] = useState<T>(initial); return [v, set, false]; } };
});

import { useJoinedCommunities } from '../useCommunityClient';

let tree: ReactTestRenderer | undefined;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; held.clear(); apis.current = 'a'; });

describe('useJoinedCommunities account switch (audit)', () => {
  it("drops the previous account's late list", async () => {
    let state: ReturnType<typeof useJoinedCommunities> | null = null;
    function Probe() { state = useJoinedCommunities(); return null; }
    await act(async () => { tree = create(<Probe />); });
    apis.current = 'b';
    await act(async () => { tree!.update(<Probe />); });
    await act(async () => { held.get('b')!([{ id: 'b-group' }]); });
    await act(async () => { held.get('a')!([{ id: 'a-group' }]); });
    expect(state!.communities.map((c) => c.id)).toEqual(['b-group']);
  });
});
