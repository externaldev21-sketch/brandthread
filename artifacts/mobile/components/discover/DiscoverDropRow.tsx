import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CachedImage } from '@/components/CachedImage';
import { ListRow } from '@/components/reframe';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { X_TYPE } from '@/constants/reframe';
import type { DiscoverDrop } from '@/lib/discoverFeed';
import { formatTimeUntil } from '@/lib/countdown';

/**
 * One drop on Discover's Drops filter — an X-style full-width row (image,
 * bold name, gray brand, status pill) with a hairline under it, instead of
 * a bordered card. Same content and destination as before.
 */
export function DiscoverDropRow({ drop }: { drop: DiscoverDrop }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <ListRow
      onPress={() => router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(drop.id)}` as never)}
      accessibilityLabel={`${drop.name}, ${drop.brandName}, ${drop.live ? 'live now' : formatTimeUntil(drop.releaseAt)}`}
      leading={drop.imageUri ? (
        <CachedImage source={{ uri: drop.imageUri }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, { backgroundColor: theme.cardElevated }]} />
      )}
      title={drop.name}
      subtitle={drop.brandName}
      trailing={(
        <View style={[styles.badge, { backgroundColor: drop.live ? theme.accent : theme.cardElevated }]}>
          <Text style={[styles.badgeText, { color: drop.live ? theme.onAccent : theme.text }]}>
            {drop.live ? 'Live' : formatTimeUntil(drop.releaseAt)}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  image: { width: 56, height: 56, borderRadius: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADII.pill },
  badgeText: { ...X_TYPE.meta, fontFamily: FONT.semibold },
});
