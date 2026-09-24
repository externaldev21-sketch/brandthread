/**
 * Structure tests: the feed's video list is bounded — only the active page
 * plus roughly the next/previous 2 stay mounted (preloaded), everything
 * else is unmounted/clipped rather than left decoding off-screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');

describe('Feed video list virtualization bounds', () => {
  it('caps how many pages (and video players) are ever mounted at once', () => {
    expect(feed).toContain('windowSize={5}');
    expect(feed).toContain('maxToRenderPerBatch={2}');
    expect(feed).toContain('initialNumToRender={3}');
  });

  it('detaches far off-screen native views on native platforms', () => {
    expect(feed).toContain("removeClippedSubviews={Platform.OS !== 'web'}");
  });

  it('still only plays the active page — others stay mounted but paused', () => {
    expect(feed).toContain('if (isActive && !paused) player.play();');
    expect(feed).toContain('else player.pause();');
  });

  it('shows the poster immediately, swapping to live video once playback starts (instant start)', () => {
    expect(feed).toContain('const showPoster = Boolean(posterSource || posterUri) && !hasStarted;');
  });
});
