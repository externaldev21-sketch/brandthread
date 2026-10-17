/**
 * Discover "Featured" rail data: admin "Featured on Discover" picks
 * (GET /api/public/featured) merged with paid Featured brand slots
 * (GET /api/featured-slots/active). Admin picks come first in their curated
 * order; a brand that is both picked and paid appears once.
 */
import type { DiscoverBrandCard } from './discoverFeed';
import type { FeaturedBrand, PublicFeaturedPicks } from './api';

export interface FeaturedThreadTile {
  postId: string;
  label: string;
  caption: string | null;
  imageUri?: string;
}

export function mergeFeaturedBrands(
  picks: PublicFeaturedPicks['brands'] | null | undefined,
  paid: FeaturedBrand[] | null | undefined,
): DiscoverBrandCard[] {
  const out: DiscoverBrandCard[] = [];
  const seen = new Set<string>();
  for (const b of picks ?? []) {
    if (!b?.userId || seen.has(b.userId)) continue;
    seen.add(b.userId);
    out.push({
      id: b.userId,
      name: b.name || 'Brand',
      verified: !!b.verified,
      imageUri: b.imageUrl ?? undefined,
      followersLabel: b.label?.trim() || 'Featured',
    });
  }
  for (const b of paid ?? []) {
    if (!b?.sellerId || seen.has(b.sellerId)) continue;
    seen.add(b.sellerId);
    out.push({ id: b.sellerId, name: b.name, verified: b.verified, imageUri: b.imageUrl ?? undefined, followersLabel: 'Featured' });
  }
  return out;
}

export function featuredThreadTiles(threads: PublicFeaturedPicks['threads'] | null | undefined): FeaturedThreadTile[] {
  const out: FeaturedThreadTile[] = [];
  const seen = new Set<string>();
  for (const t of threads ?? []) {
    if (!t?.postId || seen.has(t.postId)) continue;
    seen.add(t.postId);
    out.push({
      postId: t.postId,
      label: t.label?.trim() || 'Featured',
      caption: t.caption?.trim() || null,
      imageUri: t.thumbnailUrl ?? undefined,
    });
  }
  return out;
}
