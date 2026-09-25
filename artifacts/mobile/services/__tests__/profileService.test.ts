import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequestMock } = vi.hoisted(() => ({ serviceRequestMock: vi.fn() }));

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: serviceRequestMock }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), multiRemove: vi.fn(), getAllKeys: vi.fn(async () => []) },
}));

import {
  formatProfileCount,
  getCreatorVideosPage,
  getSellerShopPage,
  loadVideoFeedThrough,
  posterForPost,
  toShopProduct,
} from '../profileService';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'user_seller',
  mediaUrl: `https://cdn.example.com/${id}.mp4`,
  thumbnailUrl: `https://cdn.example.com/${id}.jpg`,
  mediaUrls: [],
  mediaType: 'video',
  caption: `caption ${id}`,
  authorAccountType: 'seller',
  seller: { displayName: 'Acme', brandName: 'Acme Co', username: 'acme' },
  taggedProducts: [{ productId: 'prod-1', name: 'Coat', images: ['https://cdn.example.com/coat.jpg'], priceCents: 48000 }],
  likesCount: 3,
  viewsCount: 1234,
  ...extra,
});

beforeEach(() => {
  serviceRequestMock.mockReset();
});

describe('getCreatorVideosPage', () => {
  it('reads the profile videos endpoint and maps rows to the feed player shape', async () => {
    serviceRequestMock.mockResolvedValue({
      user: { userId: 'user_seller', accountType: 'seller', displayName: 'Acme Co', username: 'acme' },
      restricted: null, total: 2, hasMore: true, videos: [row('a'), row('b')],
    });
    const page = await getCreatorVideosPage('user_seller', 0, 30);
    expect(serviceRequestMock).toHaveBeenCalledWith('/api/public/users/user_seller/videos?limit=30&offset=0', {});
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(2);
    expect(page.posts.map((post) => post.id)).toEqual(['a', 'b']);
    expect(page.posts[0]).toMatchObject({
      authorId: 'user_seller',
      authorName: 'Acme Co',
      authorHandle: '@acme',
      authorAccountType: 'seller',
      contentType: 'video',
      viewsCount: 1234,
      thumbnailUri: 'https://cdn.example.com/a.jpg',
      mediaUris: ['https://cdn.example.com/a.mp4'],
      productTags: [expect.objectContaining({ productId: 'prod-1', productName: 'Coat', priceCents: 48000 })],
    });
  });

  it('marks buyer posts as buyer-authored and surfaces the friends-only restriction', async () => {
    serviceRequestMock.mockResolvedValue({ restricted: 'friends_only', total: 0, hasMore: false, videos: [] });
    const restricted = await getCreatorVideosPage('user_buyer');
    expect(restricted.restricted).toBe('friends_only');
    expect(restricted.posts).toEqual([]);

    serviceRequestMock.mockResolvedValue({ restricted: null, total: 1, hasMore: false, videos: [row('p', { authorAccountType: 'buyer', mediaType: 'photo' })] });
    const friendView = await getCreatorVideosPage('user_buyer');
    expect(friendView.posts[0].authorAccountType).toBe('buyer');
  });

  it('asks for an uncached read when a fresh page is requested (owner after posting)', async () => {
    serviceRequestMock.mockResolvedValue({ videos: [] });
    await getCreatorVideosPage('me', 0, 30, { fresh: true });
    expect(serviceRequestMock).toHaveBeenCalledWith('/api/public/users/me/videos?limit=30&offset=0', { cache: 'no-store' });
  });
});

describe('loadVideoFeedThrough — the player opens at the tapped video', () => {
  it('keeps paging until the tapped video is loaded and returns its index', async () => {
    serviceRequestMock
      .mockResolvedValueOnce({ total: 3, hasMore: true, videos: [row('a'), row('b')] })
      .mockResolvedValueOnce({ total: 3, hasMore: false, videos: [row('c')] });
    const result = await loadVideoFeedThrough('creator', 'user_seller', 'c');
    expect(serviceRequestMock).toHaveBeenCalledTimes(2);
    expect(serviceRequestMock.mock.calls[1][0]).toContain('offset=2');
    expect(result.posts.map((post) => post.id)).toEqual(['a', 'b', 'c']);
    expect(result.startIndex).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('stops after the first page when the tapped video is on it', async () => {
    serviceRequestMock.mockResolvedValueOnce({ total: 5, hasMore: true, videos: [row('a'), row('b')] });
    const result = await loadVideoFeedThrough('creator', 'user_seller', 'b');
    expect(serviceRequestMock).toHaveBeenCalledTimes(1);
    expect(result.startIndex).toBe(1);
    expect(result.nextOffset).toBe(2);
  });

  it('reads product-scoped videos from the product endpoint', async () => {
    serviceRequestMock.mockResolvedValueOnce({ total: 1, hasMore: false, videos: [row('a')] });
    await loadVideoFeedThrough('product', 'prod-1', 'a');
    expect(serviceRequestMock.mock.calls[0][0]).toBe('/api/public/products/prod-1/videos?limit=30&offset=0');
  });

  it('falls back to the first video when the id is unknown, without looping forever', async () => {
    serviceRequestMock.mockResolvedValue({ total: 99, hasMore: true, videos: [row(`x${Math.random()}`)] });
    const result = await loadVideoFeedThrough('creator', 'user_seller', 'missing', 3);
    expect(serviceRequestMock).toHaveBeenCalledTimes(3);
    expect(result.startIndex).toBe(0);
  });
});

describe('seller shop list', () => {
  it('reads the live public listings for the seller, uncached', async () => {
    serviceRequestMock.mockResolvedValue([
      { id: 'prod-1', name: 'Coat', images: ['https://cdn.example.com/coat.jpg'], isPreOrder: false, variants: [{ priceCents: 5000, stock: 2 }, { priceCents: 4500, stock: 0 }] },
    ]);
    const page = await getSellerShopPage('user_seller', 0, 40);
    expect(serviceRequestMock).toHaveBeenCalledWith(
      '/api/public/products?ownerId=user_seller&limit=40&offset=0',
      { cache: 'no-store' },
    );
    expect(page.products).toEqual([{
      id: 'prod-1', name: 'Coat', imageUri: 'https://cdn.example.com/coat.jpg',
      priceCents: 4500, totalStock: 2, inStock: true, isPreOrder: false, category: null,
    }]);
    expect(page.hasMore).toBe(false);
  });

  it('adapts sold-out and pre-order listings honestly', () => {
    expect(toShopProduct({ id: 'p', name: 'Tee', variants: [{ priceCents: 1000, stock: 0 }] })).toMatchObject({ inStock: false, totalStock: 0 });
    expect(toShopProduct({ id: 'p', name: 'Drop', isPreOrder: true, variants: [{ priceCents: 1000, stock: 0 }] })).toMatchObject({ inStock: true, isPreOrder: true });
    expect(toShopProduct({ id: 'p', name: '', variants: [] })).toMatchObject({ name: 'Untitled product', priceCents: 0, imageUri: null });
  });
});

describe('formatting helpers', () => {
  it('formats compact counts', () => {
    expect(formatProfileCount(0)).toBe('0');
    expect(formatProfileCount(999)).toBe('999');
    expect(formatProfileCount(1234)).toBe('1.2K');
    expect(formatProfileCount(12_400)).toBe('12K');
    expect(formatProfileCount(2_500_000)).toBe('2.5M');
    expect(formatProfileCount(undefined)).toBe('0');
  });

  it('picks a poster: video thumbnail, else a photo, never a raw video file', () => {
    expect(posterForPost({ contentType: 'video', thumbnailUri: 'thumb.jpg', mediaUris: ['clip.mp4'] })).toBe('thumb.jpg');
    expect(posterForPost({ contentType: 'video', thumbnailUri: undefined, mediaUris: ['clip.mp4'] })).toBeNull();
    expect(posterForPost({ contentType: 'photo', thumbnailUri: undefined, mediaUris: ['photo.jpg'] })).toBe('photo.jpg');
  });
});
