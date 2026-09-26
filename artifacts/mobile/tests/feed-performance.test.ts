/**
 * Structure tests: the feed's video list is bounded — only the active page
 * plus roughly the next/previous 2 stay mounted (preloaded), everything
 * else is unmounted/clipped rather than left decoding off-screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
// The snap-per-page / virtualization config lives in one shared helper that
// both the Threads feed and the LIVE pager spread onto their FlatList.
const pager = readFileSync(resolve(__dirname, '../lib/feedPager.ts'), 'utf8');
const live = readFileSync(resolve(__dirname, '../app/live.tsx'), 'utf8');

describe('Feed video list virtualization bounds', () => {
  it('caps how many pages (and video players) are ever mounted at once on native', () => {
    // Native keeps the tight cap (only ~3 pages ever mounted, decoding
    // videos off-screen is expensive there). Web renders the whole (small,
    // ~10-item) preview feed instead of virtualizing it away — a low window
    // there let fast/paginated swiping outrun react-native-web's scroll-
    // driven render batching and land on a page that had never been
    // mounted at all (reported as the feed "going blank" after a few
    // swipes).
    expect(pager).toContain("windowSize: Platform.OS === 'web' ? 21 : 5,");
    expect(pager).toContain("maxToRenderPerBatch: Platform.OS === 'web' ? itemCount : 2,");
    expect(pager).toContain("initialNumToRender: Platform.OS === 'web' ? itemCount : 3,");
    expect(feed).toContain('{...verticalPagerListProps(pageHeight, displayItems.length)}');
  });

  it('detaches far off-screen native views on native platforms', () => {
    expect(pager).toContain("removeClippedSubviews: Platform.OS !== 'web',");
  });

  it('snaps one page per swipe, shared by the Threads feed and the LIVE pager', () => {
    expect(pager).toContain('pagingEnabled: true,');
    expect(pager).toContain('disableIntervalMomentum: true,');
    expect(live).toContain('{...verticalPagerListProps(pageHeight, streams.length)}');
    expect(live).toContain("import { VideoVisual } from './(tabs)/feed';");
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
