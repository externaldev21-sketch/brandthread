import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Page = { assets: Array<{ id: string; uri: string; mediaType: string }>; endCursor: string; hasNextPage: boolean };
const lib = vi.hoisted(() => {
  const resolvers: Array<{ album: string | undefined; resolve: (p: Page) => void }> = [];
  return {
    resolvers,
    SortBy: { creationTime: 'creationTime' },
    getPermissionsAsync: async () => ({ granted: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    getAlbumsAsync: async () => [{ id: 'alb-b', title: 'B', assetCount: 1 }],
    getAssetsAsync: (opts: { album?: string }) => new Promise<Page>((resolve) => { resolvers.push({ album: opts.album, resolve }); }),
  };
});
vi.mock('@/lib/mediaLibraryCompat', () => ({ getMediaLibrary: () => lib }));

import { useDeviceMedia } from '../useDeviceMedia';

let state: ReturnType<typeof useDeviceMedia> | null = null;
function Probe() { state = useDeviceMedia(); return null; }
let tree: ReactTestRenderer | undefined;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; lib.resolvers.length = 0; });

const page = (id: string): Page => ({ assets: [{ id, uri: `file:///${id}`, mediaType: 'photo' }], endCursor: id, hasNextPage: false });

describe('useDeviceMedia album switch (audit)', () => {
  it('loads the chosen album even while Recents is still loading, and drops the late Recents page', async () => {
    await act(async () => { tree = create(<Probe />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(lib.resolvers.map((r) => r.album)).toEqual([undefined]); // Recents in flight
    await act(async () => { state!.selectAlbum({ id: 'alb-b', title: 'B' }); });
    expect(lib.resolvers.map((r) => r.album)).toEqual([undefined, 'alb-b']);
    await act(async () => { lib.resolvers[1].resolve(page('b1')); });
    await act(async () => { lib.resolvers[0].resolve(page('recent1')); });
    expect(state!.album.id).toBe('alb-b');
    expect(state!.assets.map((a) => a.id)).toEqual(['b1']);
  });
});
