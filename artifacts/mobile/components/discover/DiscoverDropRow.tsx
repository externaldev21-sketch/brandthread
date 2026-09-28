import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import type { DiscoverDrop } from '@/lib/discoverFeed';

function timeUntil(iso?: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Live now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `In ${hours}h`;
  return `In ${Math.round(hours / 24)}d`;
}

export function DiscoverDropRow({ drop }: { drop: DiscoverDrop }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={() => router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(drop.id)}` as never)}
      style={[styles.row, { borderColor: theme.border }]}
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
          {drop.live ? 'Live' : timeUntil(drop.releaseAt)}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADII.card, borderWidth: 1, marginHorizontal: SP.md, marginBottom: SP.sm },
  image: { width: 56, height: 56, borderRadius: 10 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  brand: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADII.pill },
  badgeText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
