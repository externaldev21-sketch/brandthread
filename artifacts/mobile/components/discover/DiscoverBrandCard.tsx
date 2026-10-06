import React from 'react';
import { useRouter } from 'expo-router';
import { DiscoverEntityCard } from './DiscoverEntityCard';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

export function DiscoverBrandCard({ brand }: { brand: BrandCardData }) {
  const router = useRouter();
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
