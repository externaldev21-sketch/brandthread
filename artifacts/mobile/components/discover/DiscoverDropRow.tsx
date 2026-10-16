import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CachedImage } from '@/components/CachedImage';
import { ListRow } from '@/components/reframe';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { X_TYPE } from '@/constants/reframe';
import { formatDropCountdown, formatDropDate } from '@/lib/discoverFormat';
import type { DiscoverDrop } from '@/lib/discoverFeed';

function useMinuteClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/**
 * One drop on Discover's Drops filter — an X-style full-width row (image,
 * bold name, gray brand, status pill) with a hairline under it, instead of
 * a bordered card. Same content and destination as before.
 */
export function DiscoverDropRow({ drop, trailing }: { drop: DiscoverDrop; trailing?: React.ReactNode }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const now = useMinuteClock(!drop.live && !!drop.releaseAt);
  const countdown = drop.live ? null : formatDropCountdown(drop.releaseAt, now);
  const date = formatDropDate(drop.releaseAt);
  return (
    <ListRow
      onPress={() => router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(drop.id)}` as never)}
      accessibilityLabel={`${drop.name}, ${drop.brandName}, ${drop.live ? 'live now' : countdown}`}
      testID={`discover-drop-${drop.id}`}
      meta={date ?? undefined}
      leading={drop.imageUri ? (
        <CachedImage source={{ uri: drop.imageUri }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, { backgroundColor: theme.cardElevated }]} />
      )}
      title={drop.name}
      subtitle={drop.brandName}
      trailing={(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[styles.badge, { backgroundColor: drop.live ? theme.accent : theme.cardElevated }]}>
          <Text style={[styles.badgeText, { color: drop.live ? theme.onAccent : theme.text }]}>
            {drop.live ? 'Live' : countdown}
          </Text>
        </View>
        {trailing}
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
