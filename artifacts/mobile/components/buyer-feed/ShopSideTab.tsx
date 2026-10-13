/**
 * Buyer Threads Home feed — product tag chip.
 *
 * Lives INSIDE the bottom-left caption stack (CaptionBlock, via its
 * `topSlot`), directly above the creator name, left-aligned with it.
 *
 * Less-AI visual pass (V4/V10): the chip shows the tagged product itself —
 * frosted dark pill, 24pt product thumbnail, product name, price (or "Sold
 * out" when the product is sold out), chevron — instead of a bare "Shop"
 * pill that had to be tapped once to reveal the product and again to open
 * it. One tap now opens `ShopProductSheet`, like TikTok's product anchor on
 * a shoppable video (Mobbin, TikTok For You:
 * https://mobbin.com/screens/e8a9730d-ff55-4ed9-b969-3918178bdf4a — the
 * frosted anchor pill above the creator name). Static: no entrance motion,
 * no expand animation (Dev: only the product tag may have a delayed
 * appearance if one already existed — none did, so none is added).
 *
 * Still `<Glass noBlur>`: the pill sits over the playing video, and a live
 * backdrop blur would re-sample every frame (visible shimmer + cost).
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
import { Icon } from '@/components/ui/Icon';

import { Feather } from '@expo/vector-icons';

import { CachedImage } from '@/components/CachedImage';

import { Glass } from '@/components/ui/Glass';

import { TABULAR_NUMS } from '@/constants/typography';

import { FONT, ON_DARK } from '@/lib/theme';

import { RADII } from '@/constants/radii';

import { a11yHidden } from '@/lib/a11yHidden';
import { tagPriceLabel } from '@/lib/productStockInfo';

import { formatMoney } from '@/lib/format';

export interface ShopSideTabTag {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri?: string;
}

const CHIP_HEIGHT = 36;
const THUMB_SIZE = 24;

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
  tag, extraCount, onPress, soldOut = false,
}: {
  tag: ShopSideTabTag;
  extraCount: number;
  onPress: () => void;
  /** Real stock state from the public stock-info endpoint (see
   *  lib/productStockInfo.ts); false while unknown. */
  soldOut?: boolean;
}) {
  const priceLabel = tagPriceLabel(tag.priceCents, soldOut);
  return (
    <ReanimatedAnimated.View
      style={[styles.pill, containerStyle]}
      accessibilityRole="button"
      accessibilityLabel={
        expanded
          ? `Shop ${tag.productName}, ${formatMoney(tag.priceCents)}`
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
        style={styles.row}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Shop ${tag.productName}, ${priceLabel}${extraCount > 0 ? `, ${extraCount + 1} products` : ''}`}
        testID="shop-tag-pill"
      >
        <ReanimatedAnimated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          style={[styles.collapsed, collapsedStyle]}
        >
          <Icon name="shopping-bag" size={13} color={ON_DARK} />
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
              <Icon name="shopping-bag" size={13} color="#111111" />
            )}
          </View>
          <Text style={styles.name} numberOfLines={1}>{tag.productName}</Text>
          <Text style={[styles.price, soldOut && styles.soldOut]} numberOfLines={1}>
            {priceLabel}{extraCount > 0 ? ` +${extraCount}` : ''}
          </Text>
          {/* Purely decorative — the whole expanded strip is one tap
              target (the TouchableOpacity above), see the module comment. */}
          <Icon name="chevron-right" size={14} color={ON_DARK} pointerEvents="none" />
        </ReanimatedAnimated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: CHIP_HEIGHT,
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  row: {
    height: CHIP_HEIGHT,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 6, paddingRight: 10,
  },
  thumb: {
    width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  // `minWidth: 0` lets a long name ellipsize before the price is squeezed.
  name: { flexShrink: 1, minWidth: 0, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  price: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },
  soldOut: { fontFamily: FONT.semibold },
});
