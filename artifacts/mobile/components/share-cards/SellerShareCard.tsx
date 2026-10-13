import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {CachedImage as Image} from '@/components/CachedImage';
import type { SellerShareCardData } from '@/lib/shareCard';
import { sellerStoryPhoto } from '@/lib/storyCard';
import { ShareCardFrame, shareCardColors, shareCardTextStyles } from './ShareCardFrame';

interface SellerShareCardProps {
  data: Pick<SellerShareCardData, 'brandName' | 'handle' | 'logoUri' | 'products'>;
}

/**
 * Story card for a seller: one real photo (their first product photo, else
 * the store logo), the store name and @handle.
 */
export const SellerShareCard = React.forwardRef<View, SellerShareCardProps>(
  function SellerShareCard({ data }, ref) {
    const photo = sellerStoryPhoto(data.products, data.logoUri);
    return (
      <ShareCardFrame ref={ref}>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" /> : null}
        <Text style={[shareCardTextStyles.name, { color: shareCardColors.text }]} numberOfLines={2}>{data.brandName}</Text>
        {data.handle ? (
          <Text style={[shareCardTextStyles.handle, { color: shareCardColors.muted }]} numberOfLines={1}>{data.handle}</Text>
        ) : null}
      </ShareCardFrame>
    );
  },
);

const styles = StyleSheet.create({
  photo: { width: 188, height: 235 },
});
