import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {CachedImage as Image} from '@/components/CachedImage';
import type { BuyerShareCardData } from '@/lib/shareCard';
import { buyerStoryPhoto } from '@/lib/storyCard';
import { ShareCardFrame, shareCardColors, shareCardTextStyles } from './ShareCardFrame';

interface BuyerShareCardProps {
  data: Pick<BuyerShareCardData, 'name' | 'handle' | 'avatarUri'>;
}

/** Story card for a buyer: their photo (when they have one), name, @handle. */
export const BuyerShareCard = React.forwardRef<View, BuyerShareCardProps>(
  function BuyerShareCard({ data }, ref) {
    const photo = buyerStoryPhoto(data.avatarUri);
    return (
      <ShareCardFrame ref={ref}>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" /> : null}
        <Text style={[shareCardTextStyles.name, { color: shareCardColors.text }]} numberOfLines={2}>{data.name}</Text>
        {data.handle ? (
          <Text style={[shareCardTextStyles.handle, { color: shareCardColors.muted }]} numberOfLines={1}>{data.handle}</Text>
        ) : null}
      </ShareCardFrame>
    );
  },
);

const styles = StyleSheet.create({
  photo: { width: 120, height: 120, borderRadius: 60 },
});
