import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest, hasServiceToken, getThreadPostsPage } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  hasServiceToken: vi.fn(),
  getThreadPostsPage: vi.fn(),
}));

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest, hasServiceToken }));
vi.mock('@/services/socialService', () => ({
  getThreadPostsPage,
  mapApiPostToSellerThreadPost: (p: any) => ({ id: p.id, authorId: p.userId }),
}));

import { getThreadsFirstPage, mergeFollowedFirst } from './threadsFollowedFirst';

const post = (id: string) => ({ id }) as any;
const cursor = (seen: string[] = []) => ({
  followedOffset: 0, generalOffset: 30, followedDone: true, generalDone: false, seenPostIds: seen,
});
const regularPage = (ids: string[]) => ({ posts: ids.map(post), cursor: cursor(ids), hasMore: true });

describe('mergeFollowedFirst', () => {
  it('puts fresh posts first and drops their duplicates from the regular page', () => {
    const merged = mergeFollowedFirst([post('f1'), post('f2')], regularPage(['r1', 'f2', 'r2']));
    expect(merged.posts.map(p => p.id)).toEqual(['f1', 'f2', 'r1', 'r2']);
    expect(merged.hasMore).toBe(true);
  });

  it('adds fresh ids to cursor.seenPostIds once each', () => {
    const merged = mergeFollowedFirst([post('f1'), post('f1'), post('r1')], regularPage(['r1']));
    expect(merged.posts.map(p => p.id)).toEqual(['f1', 'r1']);
    expect(merged.cursor.seenPostIds.sort()).toEqual(['f1', 'r1']);
    expect(merged.cursor.generalOffset).toBe(30);
  });

  it('returns the regular page untouched when nothing is fresh', () => {
    const page = regularPage(['r1']);
    expect(mergeFollowedFirst([], page)).toBe(page);
  });
});

describe('getThreadsFirstPage', () => {
  beforeEach(() => {
    serviceRequest.mockReset();
    hasServiceToken.mockReset();
    getThreadPostsPage.mockReset();
    getThreadPostsPage.mockResolvedValue(regularPage(['r1', 'r2']));
  });

  it('leads with followed-fresh posts for a signed-in viewer', async () => {
    hasServiceToken.mockResolvedValue(true);
    serviceRequest.mockResolvedValue([{ id: 'f1', userId: 'brand-a' }, { id: 'r2', userId: 'brand-b' }]);
    const start = cursor();
    const page = await getThreadsFirstPage(start, 30);
    expect(serviceRequest).toHaveBeenCalledWith('/api/feed/followed-fresh?limit=20&hours=72', {}, false);
    expect(getThreadPostsPage).toHaveBeenCalledWith(start, 30, 'for-you');
    expect(page.posts.map(p => p.id)).toEqual(['f1', 'r2', 'r1']);
    expect(page.cursor.seenPostIds).toEqual(expect.arrayContaining(['f1', 'r1', 'r2']));
  });

  it('never calls the protected endpoint signed out', async () => {
    hasServiceToken.mockResolvedValue(false);
    const page = await getThreadsFirstPage(cursor(), 30);
    expect(serviceRequest).not.toHaveBeenCalled();
    expect(page.posts.map(p => p.id)).toEqual(['r1', 'r2']);
  });

  it('falls back to the regular page when the endpoint fails', async () => {
    hasServiceToken.mockResolvedValue(true);
    serviceRequest.mockRejectedValue(new Error('500'));
    const page = await getThreadsFirstPage(cursor(), 30);
    expect(page.posts.map(p => p.id)).toEqual(['r1', 'r2']);
  });

  it('ignores a malformed response', async () => {
    hasServiceToken.mockResolvedValue(true);
    serviceRequest.mockResolvedValue({ error: 'nope' });
    const page = await getThreadsFirstPage(cursor(), 30);
    expect(page.posts.map(p => p.id)).toEqual(['r1', 'r2']);
  });
});
