import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  },
}));

import { FINISHED_VIDEOS_KEY, finishedVideoIds, loadFinishedVideos, markVideoFinished } from './finishedVideos';

describe('finished videos — marks made before the first load resolves', () => {
  it('keeps every mark, not only the last one', async () => {
    markVideoFinished('post-a');
    markVideoFinished('post-b__loop2');
    await loadFinishedVideos();
    await new Promise((r) => setTimeout(r, 0));
    expect([...finishedVideoIds()].sort()).toEqual(['post-a', 'post-b']);
    expect(Object.keys(JSON.parse(store.get(FINISHED_VIDEOS_KEY)!)).sort()).toEqual(['post-a', 'post-b']);
  });
});
