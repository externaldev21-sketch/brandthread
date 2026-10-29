/**
 * A tile whose image failed schedules a delayed retry. If the tile is then
 * given a different image (a recycled row / refreshed post) before the timer
 * fires, the old timer used to still fire and bump the NEW image's attempt —
 * remounting it mid-load and eating one of its retries.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
vi.mock('@/components/CachedImage', () => {
  const React = require('react');
  function CachedImage(props: Record<string, unknown>) {
    React.useEffect(() => { mounts += 1; }, []);
    return React.createElement('CachedImage', props);
  }
  return { CachedImage };
});

import { DiscoverTileView } from '../DiscoverTileView';

const post = (imageUri: string) => ({
  id: 'p1', imageUri, media: 'photo', authorName: 'A', caption: '', likesCount: 0, likesHidden: false, viewsCount: 0,
}) as never;

beforeEach(() => { vi.useFakeTimers(); mounts = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('DiscoverTileView retry timer', () => {
  it('drops a pending retry when the image changes', () => {
    const noop = () => {};
    let r!: ReactTestRenderer;
    act(() => { r = create(<DiscoverTileView post={post('a.jpg')} width={100} height={133} onPress={noop} onLongPress={noop} />); });
    act(() => { r.root.findByType('CachedImage' as never).props.onError(); });

    act(() => { r.update(<DiscoverTileView post={post('b.jpg')} width={100} height={133} onPress={noop} onLongPress={noop} />); });
    const mountsAfterSwap = mounts;
    act(() => { vi.advanceTimersByTime(10_000); });

    // No remount of the new image from the old image's retry.
    expect(mounts).toBe(mountsAfterSwap);
  });
});
