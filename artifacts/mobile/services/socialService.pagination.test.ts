import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {},
}));

vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest,
}));

import {
  createThreadFeedCursor,
  getThreadPostsPage,
} from './socialService';

function apiPost(id: string) {
  return {
    id,
    userId: `seller-${id}`,
    mediaUrl: `https://images.example/${id}.jpg`,
    mediaType: 'photo',
    caption: id,
    createdAt: `2026-08-31T00:00:0${id.length}.000Z`,
    seller: { brandName: id.toUpperCase() },
  };
}

function offsetFrom(path: string): number {
  return Number(new URL(`https://brandthread.test${path}`).searchParams.get('offset'));
}

describe('Thread feed pagination', () => {
  beforeEach(() => {
    serviceRequest.mockReset();
  });

  it('keeps followed posts first across pages and advances each source independently', async () => {
    const followed = [apiPost('f1'), apiPost('f2'), apiPost('f3')];
    const general = [apiPost('f1'), apiPost('g1'), apiPost('g2')];
    serviceRequest.mockImplementation(async (path: string) => {
      const source = path.startsWith('/api/posts/feed') ? followed : general;
      const offset = offsetFrom(path);
      return source.slice(offset, offset + 2);
    });

    const first = await getThreadPostsPage(createThreadFeedCursor(), 2);
    const second = await getThreadPostsPage(first.cursor, 2);
    const third = await getThreadPostsPage(second.cursor, 2);

    expect(first.posts.map((post) => post.id)).toEqual(['f1', 'f2']);
    expect(second.posts.map((post) => post.id)).toEqual(['f3', 'g1']);
    expect(third.posts.map((post) => post.id)).toEqual(['g2']);
    expect([
      ...first.posts,
      ...second.posts,
      ...third.posts,
    ].map((post) => post.id)).toEqual(['f1', 'f2', 'f3', 'g1', 'g2']);
    expect(serviceRequest.mock.calls.map(([path]) => path)).toEqual([
      '/api/posts/feed?limit=2&offset=0',
      '/api/posts/feed?limit=2&offset=2',
      '/api/public/posts?limit=2&offset=0',
      '/api/public/posts?limit=2&offset=2',
    ]);
  });

  it('emits overlapping IDs from followed and public sources only once', async () => {
    const followed = [apiPost('shared')];
    const general = [apiPost('shared'), apiPost('public')];
    serviceRequest.mockImplementation(async (path: string) => {
      const source = path.startsWith('/api/posts/feed') ? followed : general;
      const offset = offsetFrom(path);
      return source.slice(offset, offset + 2);
    });

    const page = await getThreadPostsPage(createThreadFeedCursor(), 2);

    expect(page.posts.map((post) => post.id)).toEqual(['shared', 'public']);
    expect(page.cursor.seenPostIds).toEqual(['shared', 'public']);
  });

  it('starts refresh from fresh cursors and prevents a later page from repeating IDs', async () => {
    const responses = new Map([
      ['/api/posts/feed?limit=2&offset=0', [apiPost('fresh-1'), apiPost('fresh-2')]],
      ['/api/posts/feed?limit=2&offset=2', [apiPost('fresh-2'), apiPost('fresh-3')]],
      ['/api/posts/feed?limit=2&offset=4', []],
      ['/api/public/posts?limit=2&offset=0', []],
    ]);
    serviceRequest.mockImplementation(async (path: string) => responses.get(path) ?? []);

    const refreshed = await getThreadPostsPage(createThreadFeedCursor(), 2);
    const appended = await getThreadPostsPage(refreshed.cursor, 2);

    expect(refreshed.cursor.followedOffset).toBe(2);
    expect(refreshed.cursor.generalOffset).toBe(0);
    expect(appended.posts.map((post) => post.id)).toEqual(['fresh-3']);
    expect([...refreshed.posts, ...appended.posts].map((post) => post.id))
      .toEqual(['fresh-1', 'fresh-2', 'fresh-3']);
  });

  it('marks the feed complete when both sources return empty pages', async () => {
    serviceRequest.mockResolvedValue([]);

    const page = await getThreadPostsPage(createThreadFeedCursor(), 2);

    expect(page.posts).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toMatchObject({
      followedDone: true,
      generalDone: true,
      followedOffset: 0,
      generalOffset: 0,
    });
  });
});