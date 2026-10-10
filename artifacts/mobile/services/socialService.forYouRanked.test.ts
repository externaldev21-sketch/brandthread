import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest, hasServiceToken } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  hasServiceToken: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest, hasServiceToken }));
vi.mock('@/services/sponsoredService', () => ({ fetchSponsoredSlots: async () => [] }));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false,
  isSellerDevPreview: () => false,
  isPreviewDemoMode: () => false,
}));

import { createThreadFeedCursor, getThreadPostsPage } from './socialService';

function apiPost(id: string) {
  return {
    id,
    userId: `seller-${id}`,
    mediaUrl: `https://images.example/${id}.jpg`,
    mediaType: 'photo',
    caption: id,
    createdAt: '2026-08-31T00:00:00.000Z',
    seller: { brandName: id.toUpperCase() },
  };
}

const q = (path: string, key: string) => Number(new URL(`https://t.test${path}`).searchParams.get(key));

function mockSources(ranked: Array<ReturnType<typeof apiPost> | { type: 'live' }>, pub: ReturnType<typeof apiPost>[], rankedFails = false) {
  serviceRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/posts/repost-context')) return {};
    if (path.startsWith('/api/feed/for-you')) {
      if (rankedFails) throw new Error('500');
      const offset = q(path, 'offset');
      const limit = q(path, 'limit');
      const items = ranked.slice(offset, offset + limit);
      return { items, nextOffset: offset + limit < ranked.length ? offset + limit : null };
    }
    if (path.startsWith('/api/public/posts')) {
      const offset = q(path, 'offset');
      return pub.slice(offset, offset + q(path, 'limit'));
    }
    throw new Error(`unexpected ${path}`);
  });
}

const feedCalls = () => serviceRequest.mock.calls.map(([p]) => String(p)).filter((p) => !p.startsWith('/api/posts/repost-context'));

describe('Home For You source selection', () => {
  beforeEach(() => {
    serviceRequest.mockReset();
    hasServiceToken.mockReset();
  });

  it('serves the ranked feed first for a signed-in viewer, then continues with public posts', async () => {
    hasServiceToken.mockResolvedValue(true);
    mockSources([apiPost('r1'), { type: 'live' }, apiPost('r2')], [apiPost('r2'), apiPost('p1'), apiPost('p2')]);

    const first = await getThreadPostsPage(createThreadFeedCursor(), 2, 'for-you');
    expect(first.posts.map((p) => p.id)).toEqual(['r1', 'r2']);
    expect(first.hasMore).toBe(true);
    expect(feedCalls()[0]).toBe('/api/feed/for-you?limit=2&offset=0');

    const second = await getThreadPostsPage(first.cursor, 2, 'for-you');
    // r2 already shown: public duplicates are skipped, not repeated.
    expect(second.posts.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(second.cursor.rankedDone).toBe(true);
  });

  it('keeps guests on the public feed and never calls the protected ranked endpoint', async () => {
    hasServiceToken.mockResolvedValue(false);
    mockSources([apiPost('r1')], [apiPost('p1')]);

    const page = await getThreadPostsPage(createThreadFeedCursor(), 2, 'for-you');
    expect(page.posts.map((p) => p.id)).toEqual(['p1']);
    expect(feedCalls().some((p) => p.startsWith('/api/feed/for-you'))).toBe(false);
  });

  it('falls back to public posts when the ranked feed fails or is empty', async () => {
    hasServiceToken.mockResolvedValue(true);
    mockSources([apiPost('r1')], [apiPost('p1')], true);
    expect((await getThreadPostsPage(createThreadFeedCursor(), 2, 'for-you')).posts.map((p) => p.id)).toEqual(['p1']);

    serviceRequest.mockReset();
    mockSources([], [apiPost('p1')]);
    const page = await getThreadPostsPage(createThreadFeedCursor(), 2, 'for-you');
    expect(page.posts.map((p) => p.id)).toEqual(['p1']);
    expect(page.hasMore).toBe(false);
  });

  it('does not use the ranked feed for Following', async () => {
    hasServiceToken.mockResolvedValue(true);
    serviceRequest.mockImplementation(async (path: string) => (path.startsWith('/api/posts/feed') ? [apiPost('f1')] : {}));
    const page = await getThreadPostsPage(createThreadFeedCursor(), 2, 'following');
    expect(page.posts.map((p) => p.id)).toEqual(['f1']);
    expect(feedCalls().some((p) => p.startsWith('/api/feed/for-you'))).toBe(false);
  });
});
