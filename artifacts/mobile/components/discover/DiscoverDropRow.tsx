import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import type { DiscoverDrop } from '@/lib/discoverFeed';
import { formatTimeUntil } from '@/lib/countdown';

/** `trailing` (e.g. the notify bell) sits inside the card, beside the tappable row, never nested in it. */
export function DiscoverDropRow({ drop, trailing }: { drop: DiscoverDrop; trailing?: React.ReactNode }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <View style={styles.mainWrap}>
        <PressableScale
          onPress={() => router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(drop.id)}` as never)}
          style={styles.main}
        >
          {drop.imageUri ? (
            <CachedImage source={{ uri: drop.imageUri }} style={styles.image} contentFit="cover" />
          ) : (
            <View style={[styles.image, { backgroundColor: theme.cardElevated }]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{drop.name}</Text>
            <Text style={[styles.brand, { color: theme.muted }]} numberOfLines={1}>{drop.brandName}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: drop.live ? theme.accent : theme.cardElevated }]}>
            <Text style={[styles.badgeText, { color: drop.live ? theme.onAccent : theme.text }]}>
              {drop.live ? 'Live' : formatTimeUntil(drop.releaseAt)}
            </Text>
          </View>
        </PressableScale>
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADII.card, borderWidth: 1, marginHorizontal: SP.md, marginBottom: SP.sm },
  mainWrap: { flex: 1 },
  main: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  image: { width: 56, height: 56, borderRadius: 10 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  brand: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADII.pill },
  badgeText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
