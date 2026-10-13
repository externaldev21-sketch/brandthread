import React from 'react';
import { useRouter } from 'expo-router';
import { DiscoverEntityCard } from './DiscoverEntityCard';
import { DiscoverBrandTile } from './DiscoverBrandTile';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

/**
 * `variant="tile"` is the Brands tab's banner + overlapping-avatar tile
 * (DiscoverBrandTile); the default compact card stays for the rails and the
 * Trending brands page.
 */
export function DiscoverBrandCard({ brand, variant = 'card' }: { brand: BrandCardData; variant?: 'card' | 'tile' }) {
  const router = useRouter();
  if (variant === 'tile') return <DiscoverBrandTile brand={brand} />;
  return (
    <DiscoverEntityCard
      id={brand.id}
      name={brand.name}
      imageUri={brand.imageUri}
      verified={brand.verified}
      subline={brand.followersLabel}
      fallbackIcon="shopping-bag"
      onPress={() => router.push(`/seller-profile?id=${encodeURIComponent(brand.id)}&src=feed` as never)}
      followInitial={{ isFollowing: !!brand.isFollowing, isFollowedBy: false, isMutual: false }}
    />
  );
}
