import { describe, expect, it, vi } from 'vitest';
vi.mock('./TrendingCreatorPreview', () => ({ TrendingCreatorPreview: () => null }));
import { buildTrendingCreators, centeredIndex, previewSellerId, previewVideoUri } from './FollowingTrendingCreators';

const post = (id: string, sellerId: string, extra: Record<string, unknown> = {}) => ({
  id, sellerId, authorName: 'N' + sellerId, authorHandle: '@h', authorAccountType: 'seller', postStatus: 'published',
  contentType: 'photo', mediaUris: ['https://cdn.example/p.jpg'], visibility: { isPublic: true }, ...extra,
});
const vid = 'https://cdn.example/uploads/feed-stream/abc/720.mp4';

describe('trending creator single preview', () => {
  it('prefers each creator\'s real public video post', () => {
    const r = buildTrendingCreators([post('1', 'a'), post('2', 'a', { contentType: 'video', mediaUris: [vid], thumbnailUri: 'https://cdn.example/t.jpg' })], [], null, false);
    expect(r[0].videoUri).toBe(vid);
    expect(r[0].startPostId).toBe('2');
    expect(r[0].posterUri).toBe('https://cdn.example/t.jpg');
  });
  it('rejects localhost and photo posts (poster-only fallback)', () => {
    expect(previewVideoUri({ contentType: 'video', mediaUris: ['http://localhost:8080/v.mp4'] } as never, false)).toBeNull();
    expect(previewVideoUri({ contentType: 'photo', mediaUris: [vid] } as never, false)).toBeNull();
    expect(previewVideoUri({ contentType: 'video', mediaUris: [vid], hlsUrl: 'https://cdn.example/m.m3u8' } as never, true)).toBe('https://cdn.example/m.m3u8');
  });
  it('only the centered card with a video plays, and nothing while unfocused', () => {
    const cs = [{ sellerId: 'a', videoUri: vid }, { sellerId: 'b' }, { sellerId: 'c', videoUri: vid }] as never[];
    expect(previewSellerId(cs, 0, true)).toBe('a');
    expect(previewSellerId(cs, 1, true)).toBeNull();
    expect(previewSellerId(cs, 2, true)).toBe('c');
    expect(previewSellerId(cs, 0, false)).toBeNull();
    expect(previewSellerId(cs, -1, true)).toBeNull();
    expect(centeredIndex(287, 287, 3)).toBe(1);
    expect(centeredIndex(9999, 287, 3)).toBe(2);
  });
});
