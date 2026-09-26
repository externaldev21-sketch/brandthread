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

  it('still only plays the active, focused page — others stay mounted but paused', () => {
    // isFocused is required alongside isActive so a modal pushed on top of
    // the feed (e.g. the comments sheet) pauses playback, and — just as
    // important — coming back re-issues play() rather than leaving the
    // last decoded frame frozen. The page's measured size is also required
    // (pageWidth/pageHeight > 0) so a cell that mounts before it has a real
    // layout doesn't get stuck paused forever once it is finally measured.
    expect(feed).toContain('if (isActive && !paused && isScreenFocused && (pageWidth ?? 0) > 0 && (pageHeight ?? 0) > 0) {');
    expect(feed).toContain('player.play();');
    expect(feed).toContain('player.pause();');
  });

  it('shows the poster immediately, swapping to live video once playback starts (instant start)', () => {
    expect(feed).toContain('const showPoster = Boolean(posterSource || posterUri) && !hasStarted;');
  });
});
