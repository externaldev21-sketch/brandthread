/**
 * Buyer Threads Home feed — Shop side tab.
 *
 * Replaces the old always-visible ShopAnchorPill. A collapsed tab flush
 * against the left screen edge (the right edge is the action rail) that
 * glides out into a full card on tap, rather than an always-visible price
 * pill sitting over the video.
 *
 * Glass, not flat: this now renders the shared `<Glass/>` primitive
 * (components/ui/Glass.tsx, PR #202) with `noBlur` — a real frosted-glass
 * fill (translucent tint + specular top edge + hairline border, same
 * material as every other glass surface in the app) but with the *live*
 * backdrop blur switched off. That isn't a downgrade to flat/solid: a live
 * blur here would re-sample the playing video behind it every frame — the
 * exact per-frame shimmer/glitch this component's PR #129 rebuild moved off
 * of, and the same reasoning FeedTopBar's `hasActiveLive` pill (also
 * `noBlur`) already uses for a pill sitting directly over video. `noBlur`
 * keeps the glass look (and the one shared primitive, instead of a second
 * hand-rolled BlurView/backdrop-filter surface) without that cost.
 * Collapsed by default with zero mount/entrance animation (only a user tap
 * ever starts the expand/collapse spring), and force-collapses (no
 * animation skipped — this one transition is allowed since it's a direct
 * response to the cell leaving, matching "collapses back on swiping to the
 * next video" in spec) when the cell stops being active, so it never
 * carries an expanded state into a swipe.
 *
 * Ported from dev PR #129 (TikTok-exact feed sizing / Shop tab rebuild),
 * which supersedes the earlier PR #88 version of this component; glass +
 * product-count badge added after.
 *
 * Reference (Mobbin): Whatnot's live-room right rail "Shop" icon carries a
 * small always-on numeric badge (total items available) as its one entry
 * point into the shop sheet — https://mobbin.com/screens/a11f6531-ae96-40e0-98ce-57fe08001d6e
 * — and eBay Live's tap-through opens an "Item lineup" slide-up sheet
 * listing every tagged item — https://mobbin.com/screens/0342aaee-4b93-4156-adf4-267ba35131e1 .
 * Mirrored here as: a glass pill entry point carrying a small white count
 * badge (only shown once there's more than one tagged product — a lone "1"
 * on a pill already labeled SHOP is redundant, not informative), opening
 * `ShopProductSheet`'s own multi-tag list (its `tagListWrap` — see
 * components/ShopProductSheet.tsx) as this app's equivalent of that
 * "Item lineup" sheet, sized down to this app's TikTok-Shop-style tag
 * (Instagram/TikTok's own shopping-tag pills are single-product and don't
 * carry a count badge, and neither Depop nor GOAT have a comparable
 * video-overlay shop entry point — Whatnot/eBay Live were the closer match
 * for this specific pill-with-badge-into-sheet shape).
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
import { PanResponder } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { Glass } from '@/components/ui/Glass';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import { FONT, ON_DARK } from '@/lib/theme';
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
// values (no JS-driven Animated.Value): a 180ms ease-out timing slide out
// from the left edge into a thin horizontal strip, never a spring — no
// overshoot, and identical on web (Reanimated's web runtime) and native.
const SHOP_TAB_ANIM_MS = 180;
const SHOP_TAB_EASING = Easing.out(Easing.cubic);

export function ShopSideTab({
  tag, extraCount, onPress, isActive,
}: {
  tag: ShopSideTabTag;
  extraCount: number;
  onPress: () => void;
  isActive: boolean;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Total tagged-product count for this post — `tag` is just the first one;
  // `extraCount` is how many more there are (see the `feed.tsx` call site:
  // `extraCount={item.productTags.length - 1}`). Real seller-attached data,
  // the same `productTags`/`SpotlightProductTag` list `ShopProductSheet`'s
  // own multi-tag switcher reads — never a second/forked product-tag model.
  const totalCount = extraCount + 1;
  const [expanded, setExpanded] = useState(false);
  const progress = useSharedValue(0);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartX = useRef(0);

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

  // Swipe left anywhere on the expanded strip collapses it (in addition to
  // tapping outside, below) — a plain PanResponder is enough to recognize
  // the gesture; the actual collapse animation still runs on Reanimated.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, gesture) => expanded && gesture.dx < -6 && Math.abs(gesture.dy) < 12,
      onPanResponderGrant: (evt) => { dragStartX.current = evt.nativeEvent.pageX; },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx < -24) collapse();
      },
    }),
  ).current;

  useEffect(() => {
    if (!isActive) collapse();
    // Only reacting to the cell becoming inactive — becoming active must
    // never itself start an animation (see the module comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  // A thin horizontal strip when expanded — max ~70% of screen width, 52-56pt
  // tall (TikTok's own shop trigger footprint), sized off the live window
  // width so it holds at 375/390/430.
  const expandedWidth = Math.min(Math.round(windowWidth * 0.7), 320);
  const collapsedHeight = 76;
  const expandedHeight = 54;
  // Clamped, not a bare 57%: on the shortest screens (e.g. 375x667) with a
  // repost-identity chip and a full 2-line caption, the caption block's top
  // edge can rise as high as ~this tab's bottom edge at a bare 57%, closing
  // the gap to nothing. windowHeight - 340 only overrides the 57% on those
  // short screens — on 390x844+ this is always >= the 57% value, so the tab
  // stays exactly where it was there.
  const tabTop = Math.min(windowHeight * 0.57, windowHeight - 340);

  const containerStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [28, expandedWidth], Extrapolation.CLAMP),
    height: interpolate(progress.value, [0, 1], [collapsedHeight, expandedHeight], Extrapolation.CLAMP),
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [1, 0, 0], Extrapolation.CLAMP),
  }));
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.55, 1], [0, 0, 1], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(progress.value, [0, 0.55, 1], [8, 8, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <>
      {/* Tapping anywhere else on the video collapses the expanded card —
          rendered only while expanded, behind the tab itself in z-order. */}
      {expanded && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapse}
          {...a11yHidden(true)}
        />
      )}
      <ReanimatedAnimated.View
        style={[styles.tab, containerStyle, { top: tabTop }]}
        accessibilityRole="button"
        accessibilityLabel={
          expanded
            ? `Shop ${tag.productName}, ${formatCents(tag.priceCents)}`
            : totalCount > 1 ? `Shop this video, ${totalCount} products` : 'Shop this video'
        }
        {...panResponder.panHandlers}
      >
        {/* Glass, not a flat fill — see the module comment above for why
            this is `noBlur` (a live blur would re-sample the video behind
            it every frame) rather than a plain solid rgba backdrop. Radius
            matches the outer `tab` view's own right-corner rounding; the
            outer view's `overflow: hidden` clips this to that same
            asymmetric (flush-left) shape. */}
        <Glass variant="regular" tint="dark" radius={12} noBlur style={StyleSheet.absoluteFill} />
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
            {/* Product-count badge — only once there's more than one tagged
                product; a lone "1" next to a pill already labeled SHOP adds
                noise, not information (see the module comment's Mobbin
                reference). Sits in the pill's own unrotated coordinate
                space (this View isn't part of the -90deg `collapsedStack`
                rotation below), so it reads as a normal top-right corner
                badge regardless of the strip's rotated label. White fill +
                dark numerals — the monochrome rule's one non-text/non-red
                "chip" allowance, matching every other white-on-dark count
                chip in this app (no color accent). */}
            {totalCount > 1 && (
              <View style={styles.countBadge} {...a11yHidden(true)}>
                <Text style={styles.countBadgeText}>{totalCount > 9 ? '9+' : totalCount}</Text>
              </View>
            )}
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
              {/* Product thumbnail instead of the generic bag glyph when
                  there's an actual image to show — kept at 16pt (not the
                  36pt/radius-8 asked for) since the collapsed tab is a
                  28pt-wide rotated strip; a 36pt thumbnail doesn't fit
                  without widening the strip itself, which is a layout
                  change this polish pass isn't meant to make. Falls back
                  to the bag glyph when there's no image, same as before. */}
              {tag.imageUri ? (
                <CachedImage source={{ uri: tag.imageUri }} style={styles.collapsedThumb} contentFit="cover" />
              ) : (
                <Feather name="shopping-bag" size={11} color={ON_DARK} />
              )}
            </View>
          </ReanimatedAnimated.View>
          <ReanimatedAnimated.View
            pointerEvents={expanded ? 'auto' : 'none'}
            style={[styles.expanded, expandedStyle]}
          >
            <View style={styles.thumb}>
              {tag.imageUri ? (
                <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Feather name="shopping-bag" size={14} color="#111111" />
              )}
            </View>
            {/* Name and price share one line so the whole card reads as a
                sleek, narrow strip rather than a two-line card — the name
                truncates first (flexShrink), the price never does
                (flexShrink: 0, its own Text so numberOfLines on the name
                can't cut it off too). */}
            <Text style={styles.name} numberOfLines={1}>{tag.productName}</Text>
            <Text style={styles.price} numberOfLines={1}>
              {formatCents(tag.priceCents)}{extraCount > 0 ? ` +${extraCount}` : ''}
            </Text>
            {/* Self-audit find #3: full white, not 75% — every other icon
                in the feed (rail, top row, caption block) settled on pure
                white as this polish pass's baseline; this was the one
                holdout still reading as slightly washed out. */}
            <Feather name="chevron-right" size={12} color={ON_DARK} />
          </ReanimatedAnimated.View>
        </TouchableOpacity>
      </ReanimatedAnimated.View>
    </>
  );
}

const styles = StyleSheet.create({
  tab: {
    position: 'absolute', left: 0, height: 76,
    // Explicit stacking above the full-screen collapse backdrop Pressable
    // (rendered just before this in JSX, same parent) — without it, some
    // platforms/browsers resolved a tap on the tab's own bounds to the
    // backdrop underneath instead of the tab's TouchableOpacity, which is
    // what made the "open Shop the Post" tap sometimes just collapse the
    // strip instead.
    zIndex: 1,
    // Fill/border/specular edge now come from the <Glass/> layer rendered
    // as this view's first child (see the JSX above) — this just keeps the
    // asymmetric (flush-left) corner clip the glass, and everything after
    // it, gets cropped to.
    borderTopRightRadius: 12, borderBottomRightRadius: 12,
    overflow: 'hidden',
  },
  collapsed: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8,
  },
  // Product-count badge — small solid-white circle, dark numerals; see the
  // JSX comment above for why it's conditional on totalCount > 1.
  countBadge: {
    position: 'absolute', top: 4, right: 3,
    minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 2,
    backgroundColor: ON_DARK, alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  countBadgeText: {
    color: '#111111', fontFamily: FONT.bold, fontSize: 9, lineHeight: 11,
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
  // 16pt, matching the collapsed label's own font weight rather than the
  // expanded thumb's 8pt radius — small enough to sit inline with "SHOP"
  // in the 28pt-wide collapsed strip.
  collapsedThumb: { width: 16, height: 16, borderRadius: 4 },
  // A sleek, thin horizontal strip — fills the container's animated 54pt
  // height (see expandedHeight above), name and price sharing one line so
  // it never needs two rows of text.
  expanded: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6, gap: 8,
  },
  thumb: {
    width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  name: { flexShrink: 1, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  price: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },
});
