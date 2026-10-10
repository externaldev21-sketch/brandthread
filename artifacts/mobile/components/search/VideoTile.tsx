import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { formatCompactCount } from '@/lib/compactFormat';
import type { SearchVideo } from '@/lib/searchData';

// Fixed 9:16 aspect ratio — dark video tiles like Instagram/TikTok grids.
export const VIDEO_TILE_ASPECT = 9 / 16;

/** Video grid card — 9:16 dark thumbnail, center play affordance, caption/author overlay. */
export function VideoTile({ item, width, onPress }: {
  item: SearchVideo;
  width: number;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const height = width / VIDEO_TILE_ASPECT;

  return (
    <Pressable
      onPress={() => onPress()}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
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
        <LinearGradient
          pointerEvents="none"
          colors={['#00000000', 'rgba(0,0,0,0.55)']}
          locations={[0, 1]}
          style={styles.scrim}
        />
        <View style={styles.playBadge} pointerEvents="none">
          <Feather name="play" size={14} color="#FFFFFF" />
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
                <Text style={styles.likesText}>{formatCompactCount(item.likesCount)}</Text>
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
  // Transparent-to-black gradient over the bottom 55% keeps the caption and
  // author row legible over any thumbnail, without flattening the poster
  // image itself the way a solid wash would.
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  playBadge: {
    position: 'absolute', top: SPACING.xs, right: SPACING.xs,
    width: 26, height: 26, borderRadius: RADII.avatar,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  // No fill of its own — the gradient `scrim` beneath already carries the
  // contrast; stacking a second flat wash here was muddying the poster's
  // own bottom edge instead of keeping it readable through the gradient.
  overlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: SPACING.xs + 2,
  },
  caption: { color: '#FFFFFF', ...TYPE_SCALE.caption, fontFamily: FONT.semibold, marginBottom: 3 },
  authorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xxs },
  authorName: { color: '#FFFFFFCC', ...TYPE_SCALE.caption, fontSize: 10, flex: 1 },
  likesRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  likesText: { color: '#FFFFFFCC', ...TYPE_SCALE.caption, fontSize: 10 },
});
