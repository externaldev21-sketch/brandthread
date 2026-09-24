import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
  },
}));

import { markStoryGestureGuideShown, shouldShowStoryGestureGuide } from './storyGestureGuideStorage';

describe('story gesture guide — shown once per account', () => {
  beforeEach(() => store.clear());

  it('shows the guide the first time a user opens the story viewer', async () => {
    await expect(shouldShowStoryGestureGuide('user-1')).resolves.toBe(true);
  });

  it('does not show the guide again after it has been marked seen', async () => {
    await markStoryGestureGuideShown('user-1');
    await expect(shouldShowStoryGestureGuide('user-1')).resolves.toBe(false);
  });

  it('tracks the "shown" flag per account, not globally', async () => {
    await markStoryGestureGuideShown('user-1');
    await expect(shouldShowStoryGestureGuide('user-2')).resolves.toBe(true);
  });
});
