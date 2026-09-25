/**
 * Profile data — the creator video grid, the "featured in" videos of a
 * product, and a seller's shop list. All reads go through the same public API
 * the rest of the app uses, so a profile never shows different data than the
 * feed player or the product page it links to:
 *
 *  - videos:   GET /api/public/users/:id/videos     (same row shape as the Thread feed)
 *  - product:  GET /api/public/products/:id/videos
 *  - shop:     GET /api/public/products?ownerId=     (active listings, live prices/stock —
 *              the exact source buyer product detail and checkout read)
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { mapApiPostToSellerThreadPost, type SellerThreadPost } from '@/services/socialService';
import type { VideoFeedSource } from '@/lib/profileNavigation';

export const PROFILE_VIDEOS_PAGE_SIZE = 30;
export const PROFILE_PRODUCTS_PAGE_SIZE = 40;

export interface CreatorVideosPage {
  posts: SellerThreadPost[];
  /** Total videos the viewer may see (for the "N videos" count). */
  total: number;
  hasMore: boolean;
  nextOffset: number;
  /** Buyer profiles are friends-only; a non-friend gets an empty page and this flag. */
  restricted: 'friends_only' | null;
  user: { userId: string; accountType: 'buyer' | 'seller'; displayName: string | null; username: string | null } | null;
}

interface RawVideosResponse {
  user?: CreatorVideosPage['user'];
  restricted?: 'friends_only' | null;
  total?: number;
  hasMore?: boolean;
  videos?: any[];
}

function toPage(raw: RawVideosResponse, offset: number): CreatorVideosPage {
  const rows = Array.isArray(raw?.videos) ? raw.videos : [];
  const posts = rows
    .map((row, index) => mapApiPostToSellerThreadPost(row, offset + index))
    .filter((post) => post.mediaUris.length > 0);
  return {
    posts,
    total: typeof raw?.total === 'number' ? raw.total : posts.length,
    hasMore: raw?.hasMore === true,
    nextOffset: offset + rows.length,
    restricted: raw?.restricted === 'friends_only' ? 'friends_only' : null,
    user: raw?.user ?? null,
  };
}

/** One page of a creator's feed videos, newest first. */
export async function getCreatorVideosPage(
  userId: string,
  offset = 0,
  limit = PROFILE_VIDEOS_PAGE_SIZE,
  opts: { fresh?: boolean } = {},
): Promise<CreatorVideosPage> {
  const raw = await serviceRequest<RawVideosResponse>(
    `/api/public/users/${encodeURIComponent(userId)}/videos?limit=${limit}&offset=${offset}`,
    opts.fresh ? { cache: 'no-store' } : {},
  );
  return toPage(raw, offset);
}

/** Public videos that tag a product — the product page's "Featured in" strip. */
export async function getProductVideosPage(productId: string, offset = 0, limit = 12): Promise<CreatorVideosPage> {
  const raw = await serviceRequest<RawVideosResponse>(
    `/api/public/products/${encodeURIComponent(productId)}/videos?limit=${limit}&offset=${offset}`,
  );
  return toPage(raw, offset);
}

/** Load a page of a video feed source (creator or product). */
export function getVideoFeedPage(source: VideoFeedSource, id: string, offset: number, limit = PROFILE_VIDEOS_PAGE_SIZE) {
  return source === 'product'
    ? getProductVideosPage(id, offset, limit)
    : getCreatorVideosPage(id, offset, limit);
}

/**
 * Load pages until `postId` is on screen (a profile grid may have paged past
 * the first page before the viewer tapped a tile), capped so a stale id can
 * never loop. Returns every loaded post plus the cursor to continue from.
 */
export async function loadVideoFeedThrough(
  source: VideoFeedSource,
  id: string,
  postId: string | null | undefined,
  maxPages = 6,
): Promise<{ posts: SellerThreadPost[]; hasMore: boolean; nextOffset: number; startIndex: number }> {
  const posts: SellerThreadPost[] = [];
  let offset = 0;
  let hasMore = true;
  for (let page = 0; page < maxPages && hasMore; page += 1) {
    const result = await getVideoFeedPage(source, id, offset);
    const seen = new Set(posts.map((post) => post.id));
    posts.push(...result.posts.filter((post) => !seen.has(post.id)));
    offset = result.nextOffset;
    hasMore = result.hasMore;
    if (!postId || posts.some((post) => post.id === postId)) break;
  }
  const startIndex = postId ? Math.max(0, posts.findIndex((post) => post.id === postId)) : 0;
  return { posts, hasMore, nextOffset: offset, startIndex };
}

// ─── Shop ─────────────────────────────────────────────────────────────────────

export interface ShopProduct {
  id: string;
  name: string;
  imageUri: string | null;
  /** Lowest variant price — the price product detail opens at. */
  priceCents: number;
  totalStock: number;
  inStock: boolean;
  isPreOrder: boolean;
  category: string | null;
}

/** Adapts a GET /api/public/products row (product + variants) to a shop card. */
export function toShopProduct(row: any): ShopProduct {
  const variants: any[] = Array.isArray(row?.variants) ? row.variants : [];
  const prices = variants.map((variant) => Number(variant?.priceCents)).filter((price) => Number.isFinite(price) && price >= 0);
  const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant?.stock) || 0), 0);
  const images: unknown[] = Array.isArray(row?.images) ? row.images : [];
  const firstImage = images.find((uri): uri is string => typeof uri === 'string' && uri.length > 0) ?? null;
  const isPreOrder = row?.isPreOrder === true;
  return {
    id: String(row?.id ?? ''),
    name: typeof row?.name === 'string' && row.name.trim() ? row.name : 'Untitled product',
    imageUri: firstImage,
    priceCents: prices.length > 0 ? Math.min(...prices) : 0,
    totalStock,
    inStock: isPreOrder || totalStock > 0,
    isPreOrder,
    category: typeof row?.category === 'string' ? row.category : null,
  };
}

export interface ShopPage {
  products: ShopProduct[];
  hasMore: boolean;
  nextOffset: number;
}

/**
 * A seller's active listings. Fetched `no-store` so a seller who just listed
 * or removed a product sees it on their own shop immediately instead of a
 * 30-second public cache copy.
 */
export async function getSellerShopPage(
  sellerId: string,
  offset = 0,
  limit = PROFILE_PRODUCTS_PAGE_SIZE,
): Promise<ShopPage> {
  const rows = await serviceRequest<any[]>(
    `/api/public/products?ownerId=${encodeURIComponent(sellerId)}&limit=${limit}&offset=${offset}`,
    { cache: 'no-store' },
  );
  const list = Array.isArray(rows) ? rows : [];
  return {
    products: list.map(toShopProduct).filter((product) => product.id),
    hasMore: list.length === limit,
    nextOffset: offset + list.length,
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** 1234 → "1.2K", 2_500_000 → "2.5M" — compact counts for tiles and stats. */
export function formatProfileCount(value: number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** The poster a grid tile shows: a video's thumbnail, or a photo post's first image. */
export function posterForPost(post: Pick<SellerThreadPost, 'contentType' | 'thumbnailUri' | 'mediaUris'>): string | null {
  if (post.thumbnailUri) return post.thumbnailUri;
  if (post.contentType !== 'video') return post.mediaUris?.[0] ?? null;
  return null;
}
