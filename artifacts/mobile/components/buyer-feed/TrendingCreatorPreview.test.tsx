import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const player = vi.hoisted(() => ({
  muted: false, loop: false, play: vi.fn(), pause: vi.fn(),
  addListener: vi.fn(() => ({ remove: vi.fn() })),
}));
vi.mock('expo-video', () => ({
  useVideoPlayer: (_uri: string, setup: (p: typeof player) => void) => { setup(player); return player; },
  VideoView: () => null,
}));
vi.mock('@/lib/feedVideoDiagnostics', () => ({ recordFeedVideoError: vi.fn() }));
import { TrendingCreatorPreview } from './TrendingCreatorPreview';

describe('Following preview playback lifecycle', () => {
  it('restores playback after Strict Mode cleanup, then pauses on unmount', async () => {
    player.play.mockClear(); player.pause.mockClear();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<React.StrictMode><TrendingCreatorPreview uri="https://example.com/real-video.mp4" /></React.StrictMode>);
    });
    const lastPlaybackAction = () => [
      ...player.play.mock.invocationCallOrder.map(order => ({ order, action: 'play' })),
      ...player.pause.mock.invocationCallOrder.map(order => ({ order, action: 'pause' })),
    ].sort((a, b) => a.order - b.order).at(-1)?.action;
    expect(player.muted).toBe(true);
    expect(player.loop).toBe(true);
    expect(lastPlaybackAction()).toBe('play');
    expect(renderer.root.findAllByProps({ testID: 'trending-creator-preview-video' }).length).toBeGreaterThan(0);
    await act(async () => renderer.unmount());
    expect(lastPlaybackAction()).toBe('pause');
  });
});
