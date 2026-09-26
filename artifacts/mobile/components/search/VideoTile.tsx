import React from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { hapticPrimaryAction } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';
import type { SearchVideo } from '@/lib/searchData';

// Fixed 9:16 aspect ratio — dark video tiles like Instagram/TikTok grids.
export const VIDEO_TILE_ASPECT = 9 / 16;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Video grid card — 9:16 dark thumbnail, center play affordance, caption/author overlay. */
export function VideoTile({ item, width, onPress }: {
  item: SearchVideo;
  width: number;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const height = width / VIDEO_TILE_ASPECT;

  return (
    <Pressable
      onPress={() => { hapticPrimaryAction(); onPress(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      accessibilityRole="button"
      accessibilityLabel={`Play video by ${item.authorName}${item.caption ? `: ${item.caption}` : ''}`}
    >
      <Animated.View style={[styles.card, { width, height, transform: [{ scale }] }]}>
        {item.thumbnailUrl ? (
          <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: item.color }]}>
            <Text style={styles.fallbackInitials}>{item.initials}</Text>
          </View>
        )}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.playBadge} pointerEvents="none">
          <Feather name="play" size={16} color="#FFFFFF" />
        </View>
        <View style={styles.overlay} pointerEvents="none">
          {item.caption ? (
            <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>
          ) : null}
          <View style={styles.authorRow}>
            <Text style={styles.authorName} numberOfLines={1}>{item.authorName}</Text>
            {item.likesCount > 0 && (
              <View style={styles.likesRow}>
                <Feather name="heart" size={10} color="#FFFFFF" />
                <Text style={styles.likesText}>{formatCount(item.likesCount)}</Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: { borderRadius: RADII.card, overflow: 'hidden', backgroundColor: '#000000' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackInitials: { color: theme.onAccent, ...TYPE_SCALE.title1, fontFamily: FONT.bold },
  scrim: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%',
    backgroundColor: '#00000000',
    // Layered via borderless gradient-like scrim using two stacked views isn't
    // available without a gradient lib import here; a flat translucent black
    // wash keeps caption/author legible over any thumbnail.
  },
  playBadge: {
    position: 'absolute', top: SPACING.xs, right: SPACING.xs,
    width: 26, height: 26, borderRadius: RADII.avatar,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  overlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: SPACING.xs + 2, backgroundColor: 'rgba(0,0,0,0.38)',
  },
  caption: { color: '#FFFFFF', ...TYPE_SCALE.caption, fontFamily: FONT.semibold, marginBottom: 3 },
  authorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xxs },
  authorName: { color: '#FFFFFFCC', ...TYPE_SCALE.caption, fontSize: 10, flex: 1 },
  likesRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  likesText: { color: '#FFFFFFCC', ...TYPE_SCALE.caption, fontSize: 10 },
});
