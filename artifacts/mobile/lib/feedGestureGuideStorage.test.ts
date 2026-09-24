import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
  },
}));

import { feedGestureGuideKey, hasSeenFeedGestureGuide, markFeedGestureGuideSeen } from './feedGestureGuideStorage';

describe('Feed gesture guide — shown once per account', () => {
  beforeEach(() => { store.clear(); });

  it('scopes its "seen" flag by account, falling back to anon when signed out', () => {
    expect(feedGestureGuideKey('user_123')).toBe('feed_gesture_guide_seen:user_123');
    expect(feedGestureGuideKey(null)).toBe('feed_gesture_guide_seen:anon');
    expect(feedGestureGuideKey(undefined)).toBe('feed_gesture_guide_seen:anon');
  });

  it('has not been seen before it is marked seen', async () => {
    expect(await hasSeenFeedGestureGuide('user_123')).toBe(false);
  });

  it('stays seen for that account after being marked, independent of other accounts', async () => {
    await markFeedGestureGuideSeen('user_123');
    expect(await hasSeenFeedGestureGuide('user_123')).toBe(true);
    expect(await hasSeenFeedGestureGuide('user_456')).toBe(false);
  });
});
