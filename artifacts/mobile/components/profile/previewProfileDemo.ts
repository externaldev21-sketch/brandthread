/**
 * Own-profile content for the dev-web preview's opt-in demo dataset
 * (`?bt_preview=…&demo=1`, lib/devPreview.ts `isPreviewDemoMode()`).
 *
 * The own profiles skip every backend call in the preview, so `demo=1` used
 * to render exactly like a brand-new account (0 stats, "No posts yet").
 * These helpers fill the profile from the preview fixtures other demo
 * screens already show — the seller's seeded catalog
 * (lib/previewSellerProducts.ts) and the Discover cast
 * (lib/previewDiscover.ts) — so the demo tells one story. Every helper
 * returns null outside demo mode, so a fresh preview and every real account
 * stay empty. Fixture modules load lazily: they pull in bundled images that
 * only demo mode ever needs.
 */
import { isPreviewDemoMode } from '@/lib/devPreview';
import { MEDIA } from '@/lib/theme';
import { PREVIEW_SELLER_IDENTITY } from '@/lib/previewIdentity';
import type { DiscoverPost } from '@/lib/discoverFeed';
import type { LikedPost } from '@/lib/api';
import type { ShopProduct } from '@/services/profileService';

export interface DemoSellerProfile {
  /** Feed-player-ready posts (one per seeded listing), for the Posts grid. */
  posts: DiscoverPost[];
  /** The seeded catalog as Shop-tab cards. */
  products: ShopProduct[];
}

/** The demo seller's Posts + Shop content, or null outside demo mode. */
export async function getDemoSellerProfile(): Promise<DemoSellerProfile | null> {
  if (!isPreviewDemoMode()) return null;
  const { getPreviewSellerProducts } = await import('@/lib/previewSellerProducts');
  const catalog = getPreviewSellerProducts().filter((p) => p.status === 'active');
  const products: ShopProduct[] = catalog.map((p) => ({
    id: p.id,
    name: p.name,
    imageUri: p.media[0]?.uri ?? null,
    priceCents: p.pricing.priceCents,
    totalStock: p.inventory.totalStock,
    inStock: p.inventory.totalStock > 0,
    isPreOrder: false,
    category: p.category ?? null,
  }));
  const posts: DiscoverPost[] = catalog.map((p, i) => ({
    id: `preview-own-post-${i + 1}`,
    authorId: 'preview-seller',
    authorName: PREVIEW_SELLER_IDENTITY.brandName,
    authorHandle: PREVIEW_SELLER_IDENTITY.handle,
    authorInitials: 'PS',
    authorColor: MEDIA.background,
    authorAccountType: 'seller' as const,
    media: 'photo' as const,
    imageUri: p.media[0]?.uri,
    caption: p.name,
    likesCount: 0,
    commentsCount: 0,
    productTags: [{ productId: p.id, productName: p.name, priceCents: p.pricing.priceCents }],
    createdAt: p.createdAt,
  }));
  return { posts, products };
}

export interface DemoLikedPosts {
  posts: LikedPost[];
  /** Same posts in Discover shape, so a tap opens the feed player on them. */
  discover: DiscoverPost[];
}

/** The demo buyer's Liked tab: posts from the Discover cast, or null outside demo mode. */
export async function getDemoLikedPosts(): Promise<DemoLikedPosts | null> {
  if (!isPreviewDemoMode()) return null;
  const { getPreviewDiscoverPosts } = await import('@/lib/previewDiscover');
  const discover = getPreviewDiscoverPosts('forYou').filter((p) => !!p.imageUri).slice(0, 9);
  const posts: LikedPost[] = discover.map((p, i) => ({
    id: p.id,
    thumbnailUri: p.imageUri ?? null,
    mediaUris: p.imageUri ? [p.imageUri] : [],
    mediaType: p.media === 'video' ? 'video' as const : 'image' as const,
    caption: p.caption ?? null,
    authorId: p.authorId,
    authorName: p.authorName,
    likedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
  }));
  return { posts, discover };
}
