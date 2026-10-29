import { describe, expect, it } from 'vitest';
import { setAccountStorageScope } from './accountStorage';
import { discoverEngagementFor, rememberDiscoverEngagement } from './discoverEngagement';

describe('discoverEngagement across accounts', () => {
  it("never shows one account's like/save to the next account on the device", () => {
    setAccountStorageScope('user_a');
    const post = { id: 'p1', likesCount: 4, likedByMe: false, savedByMe: false };
    rememberDiscoverEngagement('p1', { liked: true, likesCount: 5, saved: true });
    expect(discoverEngagementFor(post)).toEqual({ liked: true, likesCount: 5, saved: true });

    setAccountStorageScope('user_b');
    expect(discoverEngagementFor(post)).toEqual({ liked: false, likesCount: 4, saved: false });
    setAccountStorageScope(null);
  });
});
