import React from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { hapticPrimaryAction } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

// Fixed 4:5 aspect ratio for every card so the grid never has uneven row
// heights — no per-image aspect-ratio measurement.
export const GRID_CARD_ASPECT = 0.8;

export type SearchProductTileItem = {
  id: string;
  name: string;
  brand: string;
  color: string;
  initials: string;
  imageUri?: string | null;
  /** Omitted for the "suggested products" empty-state set, which has no price. */
  priceCents?: number;
};

/** Product grid card — a 4:5 image, price chip overlay, name and brand row. */
export function ProductTile({ item, accent, onPress, width }: {
  item: SearchProductTileItem;
  accent: string;
  onPress: () => void;
  width: number;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';

  return (
    <Pressable
      onPress={() => { hapticPrimaryAction(); onPress(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}, ${item.brand}`}
    >
      <Animated.View style={[styles.card, { width, transform: [{ scale }] }]}>
        <View style={[styles.media, { width, height: width / GRID_CARD_ASPECT, backgroundColor: item.color }]}>
          {item.imageUri ? (
            <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.fallback}>
              <Text style={styles.fallbackInitials}>{item.initials}</Text>
              <View style={styles.fallbackLine} />
            </View>
          )}
          {typeof item.priceCents === 'number' && (
            <View style={styles.priceChip}>
              <Text style={styles.priceText}>{formatCents(item.priceCents)}</Text>
            </View>
          )}
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <View style={styles.brandRow}>
          <View style={[styles.brandDot, { backgroundColor: item.color }]} />
          <Text style={styles.brand} numberOfLines={1}>{item.brand}</Text>
          <Feather name="bookmark" size={13} color={accent} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: {},
  media: { borderRadius: RADII.card, overflow: 'hidden', justifyContent: 'flex-end' },
  fallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.background}24` },
  fallbackInitials: { color: theme.onAccent, ...TYPE_SCALE.title1, fontFamily: FONT.bold },
  fallbackLine: { width: 42, height: 2, borderRadius: 1, backgroundColor: `${theme.onAccent}8A`, marginTop: SPACING.xs + 2 },
  priceChip: { alignSelf: 'flex-start', backgroundColor: `${theme.background}C7`, borderRadius: RADII.chip, paddingHorizontal: SPACING.xs + 1, paddingVertical: SPACING.xxs + 2, margin: SPACING.xs + 1 },
  priceText: { color: theme.text, ...TYPE_SCALE.caption, fontFamily: FONT.bold },
  // Fixed height accommodates two lines so cards never shift height whether
  // the product name wraps or not (numberOfLines={2} below).
  name: { color: theme.text, ...TYPE_SCALE.callout, height: 36, fontFamily: FONT.bold, marginTop: SPACING.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs + 2, marginTop: 5, height: 20 },
  brandDot: { width: 15, height: 15, borderRadius: RADII.avatar },
  brand: { color: theme.muted, ...TYPE_SCALE.caption, flex: 1 },
});
