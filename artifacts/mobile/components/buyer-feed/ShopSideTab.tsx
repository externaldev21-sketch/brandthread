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
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [28, 218] });
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
            <Feather name="shopping-bag" size={11} color={ON_DARK} />
            <Text style={styles.label}>SHOP</Text>
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
                <Feather name="shopping-bag" size={13} color="#111111" />
              )}
            </View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>{tag.productName}</Text>
              <Text style={styles.price} numberOfLines={1}>
                {formatCents(tag.priceCents)}{extraCount > 0 ? ` +${extraCount}` : ''}
              </Text>
            </View>
            <Feather name="chevron-right" size={14} color="rgba(255,255,255,0.75)" />
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
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  label: {
    color: ON_DARK, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.5,
    transform: [{ rotate: '-90deg' }],
  },
  expanded: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, gap: 8,
  },
  thumb: {
    width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  text: { flexShrink: 1, flexGrow: 1, gap: 1 },
  name: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  price: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },
});
