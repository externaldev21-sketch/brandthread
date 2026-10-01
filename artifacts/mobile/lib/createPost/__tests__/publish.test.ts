import { describe, expect, it, vi, beforeEach } from 'vitest';

const created: any[] = [];
vi.mock('@/services/socialService', () => ({
  createSellerPost: vi.fn(async (v: any) => { created.push(v); return { id: 'p1', ...v }; }),
  updateSellerPost: vi.fn(),
}));
vi.mock('@/lib/mediaCrop', () => ({ applyCropRect: vi.fn(async (uri: string) => `${uri}#cropped`) }));

import { publishCreatePost } from '../publish';
import { DEFAULT_SLIDE_CROP } from '../crop';
import { NO_ADJUST } from '../adjust';
import type { MediaDraft, PostDetails, SlideDraft } from '../types';

const details: PostDetails = {
  caption: 'hi #fall @maya', productTags: [], scheduledAt: null,
  visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
};
const slide = (id: string, kind: 'photo' | 'video'): SlideDraft => ({
  id, kind, uri: `file:///${id}`, width: 4000, height: 3000, crop: { zoom: 2, cx: 0.5, cy: 0.5 }, adjust: { ...NO_ADJUST, brightness: 20 },
  duration: kind === 'video' ? 10 : 0, trimStart: 1, trimEnd: kind === 'video' ? 6 : 0, mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
});

function fakeApi() {
  const calls: string[] = [];
  const api: any = {
    posts: {
      uploadPhotoSlide: vi.fn(async (uri: string) => { calls.push(`photo:${uri}`); return { objectPath: `/objects/uploads/${uri.split('/').pop()}` }; }),
      uploadVideoChunked: vi.fn(async (v: any, o: any) => { calls.push(`video:${v.uri}`); o.onProgress(0.5); o.onProgress(1); return { objectPath: '/objects/uploads/vid' }; }),
      composeCarousel: vi.fn(async ({ items }: any) => ({
        items: items.map((it: any, i: number) => ({ kind: it.kind, mediaPath: `/objects/uploads/out${i}`, mediaUrl: `https://m/${i}`, thumbnailPath: `/objects/uploads/th${i}`, thumbnailUrl: `https://t/${i}`, duration: it.kind === 'video' ? 5 : undefined })),
      })),
      composeSlideshow: vi.fn(async () => ({ mediaPaths: ['/objects/uploads/a'], mediaUrls: ['https://m/a'], thumbnailPath: '/objects/uploads/t', thumbnailUrl: 'https://t/a', slideCount: 1 })),
      composeVideo: vi.fn(async () => ({ mediaUrl: 'https://m/v', mediaPath: '/objects/uploads/v', thumbnailUrl: 'https://t/v', thumbnailPath: '/objects/uploads/tv', duration: 5, clipCount: 1 })),
      composeVideoThumbnail: vi.fn(async () => ({ thumbnailUrl: 'https://t/cover', thumbnailPath: '/objects/uploads/cover', offset: 2 })),
    },
  };
  return { api, calls };
}

beforeEach(() => { created.length = 0; });

describe('publishCreatePost', () => {
  it('POST carousel: photos cropped on-device, videos chunk-uploaded with crop/trim, looks forwarded, profile surface at 3:4', async () => {
    const { api } = fakeApi();
    const media: MediaDraft = { kind: 'slides', aspect: '3:4', coverIndex: 0, slides: [slide('a.jpg', 'photo'), slide('b.mp4', 'video')] };
    const progress: number[] = [];
    await publishCreatePost({ api, input: { mode: 'post', media, details, isDraft: false }, onProgress: (f) => progress.push(f) });

    const items = api.posts.composeCarousel.mock.calls[0][0].items;
    expect(items[0]).toMatchObject({ kind: 'photo', objectPath: '/objects/uploads/a.jpg#cropped', adjust: { brightness: 20 } });
    expect(items[1]).toMatchObject({ kind: 'video', objectPath: '/objects/uploads/vid', trimStart: 1, trimEnd: 6 });
    expect(items[1].crop.width).toBeLessThan(1); // zoom 2 → half-size crop rect
    const post = created[0];
    expect(post).toMatchObject({ surface: 'profile', aspectRatio: '3:4', contentType: 'slideshow', isDraft: false, hashtags: ['#fall'] });
    expect(post.slides.map((s: any) => s.kind)).toEqual(['photo', 'video']);
    expect(post.slides[1]).toMatchObject({ path: '/objects/uploads/out1', thumbnailPath: '/objects/uploads/th1', duration: 5 });
    expect([...progress].sort((x, y) => x - y)).toEqual(progress);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('a single video POST is a video post', async () => {
    const { api } = fakeApi();
    await publishCreatePost({ api, input: { mode: 'post', media: { kind: 'slides', aspect: '3:4', coverIndex: 0, slides: [slide('c.mp4', 'video')] }, details, isDraft: true }, onProgress: () => {} });
    expect(created[0]).toMatchObject({ contentType: 'video', isDraft: true, surface: 'profile' });
  });

  it('THREAD slideshow: chosen ratio + cover index go to compose, thread surface', async () => {
    const { api } = fakeApi();
    await publishCreatePost({ api, input: { mode: 'thread', media: { kind: 'slides', aspect: '9:16', coverIndex: 2, slides: [slide('x.jpg', 'photo')] }, details, isDraft: false }, onProgress: () => {} });
    expect(api.posts.composeSlideshow).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: '9:16', surface: 'thread', coverIndex: 2 }));
    expect(created[0]).toMatchObject({ surface: 'thread', aspectRatio: '9:16', contentType: 'slideshow' });
  });

  it('THREAD video: chunked upload → compose with trim → cover frame', async () => {
    const { api } = fakeApi();
    const media: MediaDraft = { kind: 'video', video: { uri: 'file:///v.mp4', mimeType: 'video/mp4', duration: 30, speed: 1, trimStart: 2, trimEnd: 12, coverOffset: 3 } };
    await publishCreatePost({ api, input: { mode: 'thread', media, details, isDraft: false }, onProgress: () => {} });
    expect(api.posts.uploadVideoChunked).toHaveBeenCalled();
    expect(api.posts.composeVideo).toHaveBeenCalledWith(expect.objectContaining({ trimStart: 2, trimEnd: 12 }));
    expect(api.posts.composeVideoThumbnail).toHaveBeenCalledWith('/objects/uploads/v', 3);
    expect(created[0]).toMatchObject({ thumbnailUri: 'https://t/cover', surface: 'thread', contentType: 'video' });
  });

  it('a failed upload surfaces (so the screen can offer a resumable Retry) and never creates a post', async () => {
    const { api } = fakeApi();
    api.posts.uploadVideoChunked.mockRejectedValueOnce(new Error('network'));
    await expect(publishCreatePost({ api, input: { mode: 'thread', media: { kind: 'video', video: { uri: 'file:///v.mp4', duration: 9, speed: 1, trimStart: 0, trimEnd: 9, coverOffset: 0 } }, details, isDraft: false }, onProgress: () => {} })).rejects.toThrow('network');
    expect(created).toHaveLength(0);
  });
});
