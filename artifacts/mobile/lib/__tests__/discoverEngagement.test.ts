import { beforeEach, describe, expect, it } from 'vitest';
import {
  discoverEngagementFor, discoverPostApiId, rememberDiscoverEngagement, resetDiscoverEngagement, toggledLike,
} from '../discoverEngagement';

describe('discoverEngagement', () => {
  beforeEach(() => resetDiscoverEngagement());

  it('starts from the post row', () => {
    expect(discoverEngagementFor({ id: 'p1', likesCount: 4, likedByMe: true })).toEqual({ liked: true, likesCount: 4, saved: false });
  });

  it('keeps a like/save across closing and reopening the viewer', () => {
    const post = { id: 'p1', likesCount: 4 };
    rememberDiscoverEngagement('p1', { ...toggledLike(discoverEngagementFor(post)), saved: true });
    expect(discoverEngagementFor(post)).toEqual({ liked: true, likesCount: 5, saved: true });
  });

  it('never drops the like count below zero when unliking', () => {
    expect(toggledLike({ liked: true, likesCount: 0, saved: false }).likesCount).toBe(0);
  });

  it('unwraps the source prefix to the real post id', () => {
    expect(discoverPostApiId('trend_6f1c2a3e-0000-4000-8000-000000000001')).toBe('6f1c2a3e-0000-4000-8000-000000000001');
    expect(discoverPostApiId('friend_abc')).toBe('abc');
    expect(discoverPostApiId('preview-post-1')).toBe('preview-post-1');
  });
});
