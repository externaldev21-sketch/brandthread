/**
 * Buyer Threads Home feed — Shop Anchor Pill.
 *
 * A compact, single-line TikTok-Shop-style product anchor: small square
 * thumbnail, truncated product name, price, and a chevron. Sits above the
 * caption block, never larger than a small tappable tag — it must never
 * read as a card overlaying the video.
 *
 * Measurements below are informed by Mobbin references for TikTok's video
 * feed chrome (right rail icon sizing/spacing, product-anchor proportions)
 * gathered for this rebuild — see the PR description for the full list of
 * screens and numbers used to size this component and its siblings.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { FONT, ON_DARK } from '@/lib/theme';

export interface ShopAnchorTag {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri?: string;
}

export function ShopAnchorPill({
  tag, extraCount, onPress,
}: {
  tag: ShopAnchorTag;
  extraCount: number;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  // ~60% of screen width, clamped to a sane range for very small/large
  // screens — wide enough that the name and price both get real room
  // instead of truncating to "Sculpte…"/"$…" garbage.
  const pillWidth = Math.round(Math.max(220, Math.min(windowWidth * 0.6, 320)));
  const shimmer = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1600),
        Animated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, pop]);

  return (
    <Animated.View
      style={{
        opacity: pop,
        transform: [
          { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) },
          { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
        ],
      }}
    >
      <TouchableOpacity
        style={[styles.pill, { width: pillWidth, borderColor: `${theme.accent}55` }]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Shop ${tag.productName}, ${formatCents(tag.priceCents)}`}
      >
        <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.thumb}>
          {tag.imageUri ? (
            <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Feather name="shopping-bag" size={11} color="#111111" />
          )}
        </View>
        {/* Name takes the flexible remainder; price/dot/chevron are fixed and
            never shrink, so the price is always fully visible even when the
            name is long enough to need the ellipsis. */}
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{tag.productName}</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.price} numberOfLines={1}>
          {formatCents(tag.priceCents)}{extraCount > 0 ? ` +${extraCount}` : ''}
        </Text>
        <Feather name="chevron-right" size={13} color="rgba(255,255,255,0.75)" />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shimmer,
            {
              opacity: shimmer.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.45, 0.45, 0] }),
              transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-140, 220] }) }],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // ~30pt tall, width set inline to ~60% of screen width (see pillWidth
  // above) — still roughly half the height of the old two-line merch card,
  // but wide enough that the name and price both get real, non-truncated
  // room, matching TikTok Shop's compact anchor pill.
  pill: {
    height: 30, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADII.pill, paddingLeft: 4, paddingRight: 10, overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25,
    shadowRadius: 5, elevation: 4,
  },
  thumb: {
    width: 22, height: 22, borderRadius: RADII.chip, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden',
  },
  // flex: 1 (the flexible remainder) so the name takes whatever room is left
  // after the fixed-width thumb/dot/price/chevron — never squeezed to a
  // sliver by them, and never squeezing the price in turn.
  name: { flex: 1, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 12.5 },
  dot: { color: 'rgba(255,255,255,0.5)', fontSize: 12.5, flexShrink: 0 },
  // flexShrink: 0 — the price never gives up space to the name; it is
  // always rendered in full.
  price: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 12.5, ...TABULAR_NUMS },
  shimmer: { position: 'absolute', top: 0, bottom: 0, width: 40 },
});
