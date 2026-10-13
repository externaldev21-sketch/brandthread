/**
 * Discover's Drops tab card — a big image card in the same Pinterest
 * "Trending now" language as the top of For You
 * (https://mobbin.com/screens/f4099c3c-5a6f-4c32-9fd6-35d1cc2f4988): the
 * hero photo carries the countdown to release bottom-left (or a LIVE badge
 * once it's live), and the release date sits under it in tabular figures so
 * the digits line up from card to card. The countdown re-reads the clock
 * once a minute — it only ever changes when the remaining time does.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { formatDropCountdown, formatDropDate } from '@/lib/discoverFormat';
import type { DiscoverDrop } from '@/lib/discoverFeed';

const ON_PHOTO = '#FFFFFF';
const PHOTO_SHADE = 'rgba(0,0,0,0.55)';

function useMinuteClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

export function DiscoverDropRow({ drop }: { drop: DiscoverDrop }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const now = useMinuteClock(!drop.live && !!drop.releaseAt);
  const countdown = drop.live ? null : formatDropCountdown(drop.releaseAt, now);
  const date = formatDropDate(drop.releaseAt);
  return (
    <PressableScale
      onPress={() => router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(drop.id)}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${drop.name} by ${drop.brandName}${drop.live ? ', live now' : countdown ? `, starts in ${countdown}` : ''}`}
      style={styles.card}
      testID={`discover-drop-${drop.id}`}
    >
      <View style={[styles.image, { backgroundColor: theme.borderSubtle }]}>
        {drop.imageUri ? (
          <CachedImage source={{ uri: drop.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top center" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            <Feather name="zap" size={28} color={theme.muted} />
          </View>
        )}
        {drop.live ? (
          <View style={[styles.overlay, styles.liveBadge, { backgroundColor: LIVE_RED }]}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : countdown ? (
          <View style={[styles.overlay, styles.countdown]}>
            <Feather name="clock" size={13} color={ON_PHOTO} />
            <Text style={[styles.countdownText, TABULAR_NUMS]}>{countdown}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <View style={styles.titleCol}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{drop.name}</Text>
          <Text style={[styles.brand, { color: theme.muted }]} numberOfLines={1}>{drop.brandName}</Text>
        </View>
        {!!date && (
          <Text style={[styles.date, TABULAR_NUMS, { color: theme.text }]} numberOfLines={1}>{date}</Text>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: SP.md, marginBottom: SP.lg },
  // 5:4 landscape: big enough to read as a feature, short enough that the
  // next drop is already in view.
  image: { width: '100%', aspectRatio: 5 / 4, borderRadius: radius.lg, overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm },
  countdown: { gap: 6, backgroundColor: PHOTO_SHADE, paddingHorizontal: 10, paddingVertical: 6 },
  countdownText: { color: ON_PHOTO, fontFamily: FONT.semibold, fontSize: 15, lineHeight: 19 },
  liveBadge: { paddingHorizontal: 10, paddingVertical: 5 },
  liveText: { color: ON_PHOTO, fontFamily: FONT.bold, fontSize: 13, lineHeight: 16, letterSpacing: 0.6 },
  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 10 },
  titleCol: { flex: 1, minWidth: 0 },
  name: { fontFamily: FONT.semibold, fontSize: 17, lineHeight: 22 },
  brand: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, marginTop: 1 },
  date: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 22 },
});
