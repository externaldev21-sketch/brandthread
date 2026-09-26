/**
 * Buyer Threads Home feed — Shop side tab.
 *
 * Replaces the old always-visible ShopAnchorPill. A collapsed tab flush
 * against the left screen edge (the right edge is the action rail) that
 * glides out into a full card on tap, instead of an always-visible price
 * pill sitting over the video — an always-visible pill made every tagged
 * video look like an ad.
 *
 * Fully solid/flat: no BlurView/backdrop-filter, no shimmer. The old pill's
 * frosted-glass background re-sampled the moving video behind it every
 * frame during a swipe, which read as a shimmer/glitch, not a decorative
 * effect — this has no live-sampling background at all, only a fixed solid
 * fill.
 *
 * Collapsed by default with zero mount/entrance animation — only a user tap
 * ever starts the expand/collapse spring, so this can't reintroduce the
 * swipe-instability bug fixed for the rest of the rail/caption block: it
 * force-collapses (the one animated transition allowed here, since it's a
 * direct response to the cell leaving, not an entrance) when the cell stops
 * being active, so it never carries an expanded state into a swipe.
 *
 * Reference: TikTok Shop / Instagram product tags (always-visible small tag,
 * tap-to-expand) and Whatnot's collapsed side-drawer pattern for the
 * edge-attached tab shape.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import { FONT, ON_DARK } from '@/lib/theme';

export interface ShopSideTabTag {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri?: string;
}

const SHOP_TAB_COLLAPSE_MS = 4000;

export function ShopSideTab({
  tag, extraCount, onPress, isActive,
}: {
  tag: ShopSideTabTag;
  extraCount: number;
  onPress: () => void;
  isActive: boolean;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const collapse = useCallback(() => {
    clearCollapseTimer();
    setExpanded(false);
    Animated.spring(anim, { toValue: 0, useNativeDriver: false, speed: 18, bounciness: 0 }).start();
  }, [anim, clearCollapseTimer]);

  const expand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(true);
    Animated.spring(anim, { toValue: 1, useNativeDriver: false, speed: 18, bounciness: 0 }).start();
    clearCollapseTimer();
    collapseTimer.current = setTimeout(collapse, SHOP_TAB_COLLAPSE_MS);
  }, [anim, clearCollapseTimer, collapse]);

  useEffect(() => {
    if (!isActive) collapse();
    // Only reacting to the cell becoming inactive — becoming active must
    // never itself start an animation (see the module comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  // A sleek, narrow strip when expanded — max ~62% of screen width, not a
  // big card — sized off the live window width so it holds at 375/390/430.
  const expandedWidth = Math.round(windowWidth * 0.62);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [28, expandedWidth] });
  const collapsedOpacity = anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [1, 0, 0] });
  const expandedOpacity = anim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  const expandedTranslate = anim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [8, 8, 0] });

  return (
    <>
      {expanded && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapse}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <Animated.View
        style={[styles.tab, { width }]}
        accessibilityRole="button"
        accessibilityLabel={
          expanded
            ? `Shop ${tag.productName}, ${formatCents(tag.priceCents)}`
            : 'Shop this video'
        }
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={0.85}
          onPress={expanded ? onPress : expand}
        >
          <Animated.View
            pointerEvents={expanded ? 'none' : 'auto'}
            style={[styles.collapsed, { opacity: collapsedOpacity }]}
          >
            {/* Icon + label are laid out and rotated together as ONE unit,
                not rotated separately: rotating only the Text keeps its
                pre-rotation (unrotated) box for layout purposes, so
                anything positioned relative to that stale box — like the
                icon above it in a flex column — lands using the wrong
                effective width/height once the text is actually rotated,
                which is what put the bag icon on top of the "P". Laid out
                here as a plain horizontal row (label, then icon) and
                rotated as a whole: a -90deg turn maps "left" to the
                bottom and "right" to the top, so the label (left) reads
                bottom-to-top exactly as before and the icon (right) ends
                up above it, with real layout-computed spacing between
                them instead of a stale gap. */}
            <View style={styles.collapsedStack}>
              <Text style={styles.label}>SHOP</Text>
              <Feather name="shopping-bag" size={11} color={ON_DARK} />
            </View>
          </Animated.View>
          <Animated.View
            pointerEvents={expanded ? 'auto' : 'none'}
            style={[
              styles.expanded,
              { opacity: expandedOpacity, transform: [{ translateX: expandedTranslate }] },
            ]}
          >
            <View style={styles.thumb}>
              {tag.imageUri ? (
                <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Feather name="shopping-bag" size={11} color="#111111" />
              )}
            </View>
            {/* Name and price share one line so the whole card reads as a
                sleek, narrow strip at ~44pt tall rather than a two-line
                card — the name truncates first (flexShrink), the price
                never does (flexShrink: 0, its own Text so numberOfLines on
                the name can't cut it off too). */}
            <Text style={styles.name} numberOfLines={1}>{tag.productName}</Text>
            <Text style={styles.price} numberOfLines={1}>
              {formatCents(tag.priceCents)}{extraCount > 0 ? ` +${extraCount}` : ''}
            </Text>
            <Feather name="chevron-right" size={12} color="rgba(255,255,255,0.75)" />
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  tab: {
    position: 'absolute', left: 0, top: '57%', height: 76,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopRightRadius: 12, borderBottomRightRadius: 12,
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  collapsed: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8,
  },
  // A plain horizontal row (label, then icon) — normal, unrotated layout —
  // rotated as a whole once it's already sized. Centering this on both axes
  // keeps it centered in the tab regardless of its rotated bounding box.
  collapsedStack: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    transform: [{ rotate: '-90deg' }],
  },
  label: {
    color: ON_DARK, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.5,
  },
  // A sleek, narrow strip — 44pt tall (roughly the same visual height
  // family as the collapsed tab, not a noticeably taller card), name and
  // price sharing one line so it never needs two rows of text.
  expanded: {
    position: 'absolute', top: 16, left: 0, right: 0, height: 44,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6, gap: 8,
  },
  thumb: {
    width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  name: { flexShrink: 1, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  price: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },
});
