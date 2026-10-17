/**
 * Less-AI pass, items 85 / 89 / 90: tabs keep their place and their content.
 *  - 85: long browsable lists keep their scroll position when you come back
 *        (Friends joins the existing exception list in hooks/useScrollReset).
 *  - 89: coming back to the seller Products tab re-fetches silently — no
 *        skeleton for the list already on screen, and a failed background
 *        refresh never wipes it.
 *  - 90: the feed warms the images of the next 3 posts (every slide of a
 *        photo post, the poster of a video post) into memory + disk.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('85: long lists keep their place', () => {
  it('Friends keeps its scroll position when the screen regains focus', () => {
    expect(read('app/(buyer)/friends.tsx')).toContain('useScrollReset<any>(true, false)');
  });
});

describe('89: no loader between tabs', () => {
  const products = read('app/(tabs)/products.tsx');

  it('only shows the loading state when the filter or search changed', () => {
    expect(products).toContain('const silent = loadedKeyRef.current === key;');
    expect(products).toContain('if (!silent) setLoading(true);');
    expect(products).toContain('loadedKeyRef.current = key;');
  });

  it('a failed background refresh keeps the list on screen', () => {
    expect(products).not.toContain('if (!silent) setProducts([]);');
    expect(products).toContain('const silent = loadedKeyRef.current === key;');
  });
});

describe('90: feed preloads images 3 ahead', () => {
  const feed = read('app/(tabs)/feed.tsx');

  it('warms the next 3 posts through the memory-disk prefetch', () => {
    expect(feed).toContain('const FEED_IMAGE_PRELOAD_AHEAD = 3;');
    expect(feed).toContain('i <= activeIndex + FEED_IMAGE_PRELOAD_AHEAD');
    expect(feed).toContain('for (const uri of uris) prefetchImage(uri);');
  });
});
