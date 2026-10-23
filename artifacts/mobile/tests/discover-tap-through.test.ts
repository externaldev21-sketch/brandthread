/**
 * Discover tile tap → the real Threads feed player (app/discover-player.tsx),
 * not the separate DiscoverPostViewer overlay.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/services/socialService', () => ({
  mapApiPostToSellerThreadPost: (raw: any) => ({
    id: raw.id,
    mediaUris: raw.mediaUrl ? [raw.mediaUrl] : [],
    contentType: raw.mediaType,
    likedByMe: false,
    savedByMe: false,
  }),
}));

import type { DiscoverPost } from '@/lib/discoverFeed';
import {
  discoverPostApiId, getDiscoverPlayerQueue, loadDiscoverPlayerPage, setDiscoverPlayerQueue,
} from '@/lib/discoverPlayerQueue';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function post(id: string, extra: Partial<DiscoverPost> = {}): DiscoverPost {
  return {
    id, authorId: 'a', authorName: 'A', authorHandle: '@a', authorInitials: 'A', authorColor: '#222',
    authorAccountType: 'seller', media: 'photo', imageUri: `https://img/${id}.jpg`,
    likesCount: 1, commentsCount: 0, createdAt: '2026-10-01T00:00:00.000Z', ...extra,
  };
}

describe('discoverPlayerQueue', () => {
  beforeEach(() => { serviceRequest.mockReset(); });

  it('puts the tapped post first, then the posts after it, then the ones before', () => {
    const token = setDiscoverPlayerQueue([post('p0'), post('p1'), post('p2'), post('p3')], 2);
    expect(getDiscoverPlayerQueue(token).map((p) => p.id)).toEqual(['p2', 'p3', 'p0', 'p1']);
  });

  it('strips the Discover source prefix back to the real post id', () => {
    expect(discoverPostApiId(`trend_${UUID(1)}`)).toBe(UUID(1));
    expect(discoverPostApiId(`friend_${UUID(2)}`)).toBe(UUID(2));
    expect(discoverPostApiId('preview-fit-1')).toBe('preview-fit-1');
  });

  it('resolves real posts (video source) and falls back to the tile for fixtures/failures', async () => {
    serviceRequest.mockImplementation(async (path: string) => {
      if (path.endsWith(UUID(1))) return { id: UUID(1), mediaUrl: 'https://v/1.mp4', mediaType: 'video' };
      throw new Error('offline');
    });
    const token = setDiscoverPlayerQueue([
      post(`trend_${UUID(1)}`, { likedByMe: true }),
      post(`friend_${UUID(2)}`),
      post('preview-fit-3'),
    ], 0);
    const page = await loadDiscoverPlayerPage(token, 0, 2);
    expect(page.posts.map((p) => p.id)).toEqual([UUID(1), UUID(2)]);
    expect(page.posts[0].contentType).toBe('video');
    expect(page.posts[0].mediaUris).toEqual(['https://v/1.mp4']);
    expect(page.posts[0].likedByMe).toBe(true);
    expect(page.posts[1].mediaUris).toEqual([`https://img/friend_${UUID(2)}.jpg`]);
    expect(page).toMatchObject({ hasMore: true, nextOffset: 2 });

    const rest = await loadDiscoverPlayerPage(token, 2, 2);
    expect(rest.posts.map((p) => p.id)).toEqual(['preview-fit-3']);
    expect(rest).toMatchObject({ hasMore: false, nextOffset: 3 });
    // Fixture ids never hit the network.
    expect(serviceRequest).toHaveBeenCalledTimes(2);
  });
});

describe('Discover tap-through wiring', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('Discover routes tile taps to the feed player instead of DiscoverPostViewer', () => {
    const src = read('app/(buyer)/discover.tsx');
    expect(src).not.toMatch(/DiscoverPostViewer/);
    expect(src).toMatch(/setDiscoverPlayerQueue\(/);
    expect(src).toMatch(/router\.push\(`\/discover-player\?q=/);
  });

  it('the player route is the Threads FeedScreen in its discover mode', () => {
    const src = read('app/discover-player.tsx');
    expect(src).toMatch(/import FeedScreen from '\.\/\(tabs\)\/feed'/);
    expect(src).toMatch(/source: 'discover'/);
  });
});
