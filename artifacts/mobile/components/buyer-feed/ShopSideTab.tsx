/**
 * Buyer Threads Home feed — Shop tag pill.
 *
 * Resting-state redesign (polish pass): the old always-vertical "SHOP" side
 * tab — a rotated label flush against the screen's left edge at mid-height,
 * with a small white product-count badge in its corner — is gone. In its
 * place, a compact horizontal TikTok-Shop-style product-anchor pill now
 * lives INSIDE the bottom-left caption stack (CaptionBlock, via its
 * `topSlot`), directly above the creator name, left-aligned with it. No
 * count number anywhere on the resting pill.
 *
 * Reference (Mobbin): TikTok Shop's own video product-anchor pill — a
 * small dark glass "Shop" pill sitting in a video's bottom-left caption
 * area (product-anchor tag on a shoppable video), not a screen-edge rail —
 * https://mobbin.com/screens/8f86927b-bff7-44d1-8f66-7264d31e76d5 (TikTok
 * Shop, "Video with product anchor"). This replaces the previous Whatnot/
 * eBay-Live-rail reference this file's resting state used to follow; that
 * reference now only informs the EXPANDED strip's "whole row opens the
 * sheet" behavior below, which is unchanged.
 *
 * Tap interaction is unchanged from before this pass: tapping the resting
 * pill slides it out (Reanimated, UI thread, no bounce) into a thin
 * horizontal strip showing the first tagged product's name + price + a
 * chevron; tapping that expanded strip opens `ShopProductSheet`; tapping
 * anywhere else on the video collapses it back. Only the resting pill's
 * position and visual design changed — the animation, timing, and the
 * expanded strip's own look are all ported as-is from the previous
 * screen-edge version (dev PR #129 → this file's own #202/#312/#336
 * history), just re-anchored to the new resting position/style.
 *
 * State (`useShopTagPill`) is lifted out of the pill's own rendering so the
 * full-screen "tap outside to collapse" backdrop can be rendered at the
 * feed cell's top level (it must cover the whole video, not just the small
 * caption-stack box the pill itself now lives in) while the pill's actual
 * visuals render nested inside CaptionBlock's stack — see app/(tabs)/
 * feed.tsx's FeedCell for how the two are wired together off one shared
 * hook instance.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import ReanimatedAnimated, {
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Extrapolation,
  interpolate,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { Glass } from '@/components/ui/Glass';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import { FONT, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { a11yHidden } from '@/lib/a11yHidden';

export interface ShopSideTabTag {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri?: string;
}

// Collapsed by default with no mount/entrance animation — only a user tap
// starts the expand/collapse spring — and force-collapses (allowed, since
// it's a direct response to the cell leaving) when the cell stops being
// active, so it never carries an expanded state into a swipe.
const SHOP_TAB_COLLAPSE_MS = 4000;

// Expand/collapse runs entirely on the UI thread via Reanimated shared
// values (no JS-driven Animated.Value): a 180ms ease-out timing slide,
// never a spring — no overshoot, identical on web and native.
const SHOP_TAB_ANIM_MS = 180;
const SHOP_TAB_EASING = Easing.out(Easing.cubic);

const COLLAPSED_HEIGHT = 32;
const EXPANDED_HEIGHT = 48;
// Fixed estimate for the collapsed pill's own (fixed-content: bag icon +
// "Shop") natural width — used only as the animation's FROM value; the
// resting pill's actual layout is plain flexbox, so this only has to be a
// reasonable width to slide out from, not pixel-exact.
const COLLAPSED_WIDTH = 78;

export interface ShopTagPillState {
  expanded: boolean;
  progress: ReturnType<typeof useSharedValue<number>>;
  expand: () => void;
  collapse: () => void;
}

/** Owns the expand/collapse state + Reanimated progress shared by both the
 *  full-screen collapse backdrop (`ShopTagBackdrop`) and the pill itself
 *  (`ShopTagPill`) — see the module comment above for why these are split. */
export function useShopTagPill(isActive: boolean): ShopTagPillState {
  const [expanded, setExpanded] = useState(false);
  const progress = useSharedValue(0);
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
    progress.value = withTiming(0, { duration: SHOP_TAB_ANIM_MS, easing: SHOP_TAB_EASING });
  }, [progress, clearCollapseTimer]);

  const expand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(true);
    progress.value = withTiming(1, { duration: SHOP_TAB_ANIM_MS, easing: SHOP_TAB_EASING });
    clearCollapseTimer();
    collapseTimer.current = setTimeout(collapse, SHOP_TAB_COLLAPSE_MS);
  }, [progress, clearCollapseTimer, collapse]);

  useEffect(() => {
    if (!isActive) collapse();
    // Only reacting to the cell becoming inactive — becoming active must
    // never itself start an animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  return { expanded, progress, expand, collapse };
}

/** Full-screen "tap outside collapses the expanded pill" backdrop — render
 *  as a sibling at the feed cell's top level (before the pill's own visual,
 *  same z-order convention as before), NOT nested inside CaptionBlock's
 *  small stack box, so it actually covers the whole video. */
export function ShopTagBackdrop({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  if (!visible) return null;
  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={onPress}
      {...a11yHidden(true)}
    />
  );
}

/**
 * The pill itself — rendered inside CaptionBlock's stack (its `topSlot`),
 * left-aligned with the creator name below it. Resting state: a compact
 * dark-glass "Shop" pill (bag glyph + label, no count badge, no thumbnail —
 * kept deliberately minimal so it never crowds at the smallest tested width,
 * 320pt). Tapping it expands into a thin strip (first tagged product's name
 * + price + chevron); tapping THAT opens the sheet.
 */
export function ShopTagPill({
  tag, extraCount, onPress, state,
}: {
  tag: ShopSideTabTag;
  extraCount: number;
  onPress: () => void;
  state: ShopTagPillState;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const totalCount = extraCount + 1;
  const { expanded, progress, expand } = state;

  // Expanded width is capped to the caption stack's own available width
  // (CaptionBlock's root: left 16, right 84 for the action rail — see
  // CaptionBlock.tsx), not a bare fraction of the full window, since this
  // pill now lives INSIDE that stack instead of floating over the whole
  // video edge-to-edge. Clamped so the expanded strip (product name + price
  // + chevron) never clips at 320pt, the tightest tested width.
  const captionStackWidth = windowWidth - 16 - 84;
  const expandedWidth = Math.max(180, Math.min(captionStackWidth - 8, 240));

  const containerStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [COLLAPSED_WIDTH, expandedWidth], Extrapolation.CLAMP),
    height: interpolate(progress.value, [0, 1], [COLLAPSED_HEIGHT, EXPANDED_HEIGHT], Extrapolation.CLAMP),
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [1, 0, 0], Extrapolation.CLAMP),
  }));
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.55, 1], [0, 0, 1], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(progress.value, [0, 0.55, 1], [8, 8, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <ReanimatedAnimated.View
      style={[styles.pill, containerStyle]}
      accessibilityRole="button"
      accessibilityLabel={
        expanded
          ? `Shop ${tag.productName}, ${formatCents(tag.priceCents)}`
          : totalCount > 1 ? `Shop this video, ${totalCount} products` : 'Shop this video'
      }
    >
      {/* Dark frosted glass, `noBlur` — this pill still sits directly over
          the playing video (just lower/left now, inside the caption stack,
          not screen-edge), so a live per-frame backdrop blur here would be
          the same re-sample-every-frame cost this file's original module
          comment called out for the old screen-edge tab. Reusing the one
          shared `<Glass/>` primitive (dark tint, its own built-in ~30-40%
          black fill + ~22%-opacity hairline border + specular edge) instead
          of a one-off BlurView/rgba pair keeps this pill visually
          consistent with every other glass surface in the app rather than
          inventing a slightly different opacity recipe for just this one. */}
      <Glass variant="regular" tint="dark" radius={16} noBlur style={StyleSheet.absoluteFill} />
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={0.85}
        onPress={expanded ? onPress : expand}
        testID="shop-tag-pill"
      >
        <ReanimatedAnimated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          style={[styles.collapsed, collapsedStyle]}
        >
          <Feather name="shopping-bag" size={13} color={ON_DARK} />
          <Text style={styles.label}>Shop</Text>
        </ReanimatedAnimated.View>
        <ReanimatedAnimated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          // Laid out at the full expanded width (not the animating pill
          // width) so the price ("$480.00 +1") is never squeezed/clipped
          // inside its own box while the pill grows; the pill's own
          // overflow:hidden does the reveal instead (QA-1111).
          style={[styles.expanded, { right: undefined, width: expandedWidth }, expandedStyle]}
        >
          <View style={styles.thumb}>
            {tag.imageUri ? (
              <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Feather name="shopping-bag" size={13} color="#111111" />
            )}
          </View>
          <Text style={styles.name} numberOfLines={1}>{tag.productName}</Text>
          <Text style={styles.price} numberOfLines={1}>
            {formatCents(tag.priceCents)}{extraCount > 0 ? ` +${extraCount}` : ''}
          </Text>
          {/* Purely decorative — the whole expanded strip is one tap
              target (the TouchableOpacity above), see the module comment. */}
          <Feather name="chevron-right" size={12} color={ON_DARK} pointerEvents="none" />
        </ReanimatedAnimated.View>
      </TouchableOpacity>
    </ReanimatedAnimated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  collapsed: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12,
  },
  label: {
    color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13,
  },
  expanded: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6, gap: 8,
  },
  thumb: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  name: { flexShrink: 1, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  price: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },
});
