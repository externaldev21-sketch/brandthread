import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const created: string[] = [];
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('expo-video', () => ({
  createVideoPlayer: ({ uri }: { uri: string }) => { created.push(uri); return { muted: false, loop: true, release: () => {} }; },
  setVideoCacheSizeAsync: async () => {},
}));
// Production keeps only the already-mounted next page warm. Give this hook
// test an explicit extra-player plan so it can exercise creation/cancellation
// without changing the app's existing decoder budget.
// The hook warms upcoming videos by fetching their bytes
// (preloadVideoBytes), never by allocating a player/decoder — so that fetch
// is what this test counts.
vi.mock('@/lib/videoPreload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/videoPreload')>();
  return {
    ...actual,
    planVideoPreload: (items: readonly import('@/lib/videoPreload').PreloadCandidate[], index: number) =>
      actual.planVideoPreload(items, index, { ahead: 3, mountedAhead: 1 }),
    preloadVideoBytes: async (uri: string) => { created.push(uri); },
  };
});

import { useFeedVideoPreload } from './useFeedVideoPreload';

const items = Array.from({ length: 6 }, (_, i) => ({ kind: 'video' as const, uri: `https://cdn.test/v${i}.mp4` }));

function Consumer({ dataSaver, index }: { dataSaver: boolean; index: number }) {
  useFeedVideoPreload(items, index, true, dataSaver);
  return null;
}

async function mount(dataSaver: boolean) {
  await import('expo-video'); // warm the mocked module so the hook's import resolves at once
  created.length = 0;
  let r!: ReturnType<typeof create>;
  await act(async () => {
    r = create(<Consumer dataSaver={dataSaver} index={0} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  // Swipe to the next video: the preload plan is applied again.
  await act(async () => {
    r.update(<Consumer dataSaver={dataSaver} index={1} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await act(async () => { r.unmount(); });
  return [...created];
}

describe('useFeedVideoPreload and "Use less cellular data" (#154)', () => {
  it('warms the upcoming videos normally', async () => {
    expect((await mount(false)).length).toBeGreaterThan(0);
  });
  it('fetches nothing ahead when the viewer turned on data saver', async () => {
    expect(await mount(true)).toEqual([]);
  });
});
