import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest, hasServiceToken } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  hasServiceToken: vi.fn(async () => true),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest, hasServiceToken }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isPreviewDemoMode: () => false }));

import { createThreadFeedCursor, getThreadPostsPage } from './socialService';
import { flushOfficialSeedProgress, noteThreadOnScreen } from './officialSeedService';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const real = (n: number) => ({
  id: uuid(n), userId: `seller-${n}`, mediaUrl: `https://cdn.test/${n}.mp4`, mediaType: 'video',
  caption: `real ${n}`, createdAt: '2026-10-01T00:00:00.000Z', seller: { brandName: `Seller ${n}` },
});
const official = (n: number) => ({
  id: uuid(900 + n), userId: 'brandthread-official', mediaUrl: `https://cdn.test/o${n}.mp4`, mediaType: 'video',
  caption: `official ${n}`, createdAt: '2026-10-01T00:00:00.000Z',
  seller: { brandName: 'Brandthread', username: 'brandthread', isOfficial: true, verified: true },
  credit: { handle: 'galoreyyz', name: null, userId: null, accountType: null },
});

describe('Threads feed: new-user @brandthread seeding', () => {
  beforeEach(() => {
    serviceRequest.mockReset();
    hasServiceToken.mockResolvedValue(true);
  });

  it('puts the server-planned official Thread in slot 1 with its credit and official flag', async () => {
    const rows = [real(1), real(2), real(3)];
    serviceRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/public/posts')) return path.includes('offset=0') ? rows : [];
      if (path.startsWith('/api/feed/official-seed?')) {
        const params = new URL(`https://t${path}`).searchParams;
        expect(params.get('organicIds')).toBe(rows.map((r) => r.id).join(','));
        return {
          seeding: true,
          items: [{ type: 'official', post: official(1) }, ...rows.slice(0, 2).map((r) => ({ type: 'organic', id: r.id })),
            { type: 'official', post: official(2) }, { type: 'organic', id: rows[2].id }],
          cursor: { position: 5, lastOfficialPosition: 4 },
        };
      }
      return {};
    });

    const page = await getThreadPostsPage(createThreadFeedCursor(), 30, 'for-you');
    expect(page.posts.map((p) => p.caption)).toEqual(['official 1', 'real 1', 'real 2', 'official 2', 'real 3']);
    expect(page.posts[0].isOfficial).toBe(true);
    expect(page.posts[0].authorHandle).toBe('@brandthread');
    expect(page.posts[0].credit).toEqual({ handle: 'galoreyyz', name: null, userId: null, accountType: null });
    expect(page.cursor.officialSeed).toMatchObject({ position: 5, lastOfficialPosition: 4, served: [uuid(901), uuid(902)] });
  });

  it('sends served official ids as `exclude` on the next page so none repeats', async () => {
    const calls: string[] = [];
    serviceRequest.mockImplementation(async (path: string) => {
      calls.push(path);
      if (path.startsWith('/api/public/posts')) return [real(10)];
      if (path.startsWith('/api/feed/official-seed?')) return { seeding: true, items: [{ type: 'organic', id: uuid(10) }], cursor: { position: 6, lastOfficialPosition: 4 } };
      return {};
    });
    const cursor = { ...createThreadFeedCursor(), officialSeed: { position: 5, lastOfficialPosition: 4, served: [uuid(901)] } };
    await getThreadPostsPage(cursor, 30, 'for-you');
    const seedCall = calls.find((c) => c.startsWith('/api/feed/official-seed?'))!;
    const params = new URL(`https://t${seedCall}`).searchParams;
    expect(params.get('exclude')).toBe(uuid(901));
    expect(params.get('position')).toBe('5');
    expect(params.get('lastOfficialPosition')).toBe('4');
  });

  it('leaves the organic page untouched (and stops asking) for users who are not seeded', async () => {
    const calls: string[] = [];
    serviceRequest.mockImplementation(async (path: string) => {
      calls.push(path);
      if (path.startsWith('/api/public/posts')) return path.includes('offset=0') ? [real(1), real(2)] : [];
      if (path.startsWith('/api/feed/official-seed?')) return { seeding: false, reason: 'not_new_user' };
      return {};
    });
    const first = await getThreadPostsPage(createThreadFeedCursor(), 2, 'for-you');
    expect(first.posts.map((p) => p.caption)).toEqual(['real 1', 'real 2']);
    expect(first.cursor.officialSeed?.done).toBe(true);
    await getThreadPostsPage(first.cursor, 2, 'for-you');
    expect(calls.filter((c) => c.startsWith('/api/feed/official-seed')).length).toBe(1);
    // Not seeded → on-screen notes never reach the server.
    noteThreadOnScreen(uuid(1), false);
    await flushOfficialSeedProgress();
    expect(calls.some((c) => c.startsWith('/api/feed/official-seed/progress'))).toBe(false);
  });

  it('never seeds the Following tab', async () => {
    serviceRequest.mockImplementation(async (path: string) => (path.startsWith('/api/posts/feed') ? [official(1), real(1)] : []));
    const page = await getThreadPostsPage(createThreadFeedCursor(), 2, 'following');
    expect(serviceRequest.mock.calls.some(([p]) => String(p).startsWith('/api/feed/official-seed'))).toBe(false);
    expect(page.posts.map((p) => p.caption)).toEqual(['official 1', 'real 1']);
  });

  it('reports seen official Threads and views while seeded', async () => {
    serviceRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/public/posts')) return [real(1)];
      if (path.startsWith('/api/feed/official-seed?')) return { seeding: true, items: [{ type: 'official', post: official(1) }, { type: 'organic', id: uuid(1) }], cursor: { position: 2, lastOfficialPosition: 1 } };
      return {};
    });
    await getThreadPostsPage(createThreadFeedCursor(), 1, 'for-you');
    noteThreadOnScreen(uuid(901), true);
    noteThreadOnScreen(`${uuid(901)}__loop1`, true); // loop copy counts once
    noteThreadOnScreen(uuid(1), false);
    await flushOfficialSeedProgress();
    const call = serviceRequest.mock.calls.find(([p]) => p === '/api/feed/official-seed/progress');
    expect(JSON.parse(call![1].body)).toEqual({ seenPostIds: [uuid(901)], viewedCount: 2 });
  });
});
