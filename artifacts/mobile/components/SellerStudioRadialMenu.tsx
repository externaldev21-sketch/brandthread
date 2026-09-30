/**
 * SellerStudioRadialMenu — Seller Control Center
 *
 * The sheet opened from the tab bar's Studio button (accessibilityLabel
 * "Open Studio tools"). Despite the file's historical name (kept so the tab
 * bar's import and the native device-interaction contract test don't need to
 * change), this is now a full-screen "card carousel": one destination shown
 * at a time as a huge centered icon + name, with its silver, faded neighbors
 * peeking in at the edges so it reads as a single continuous list rather
 * than a picker wheel. Dev's words: "every icon is its own screen, swipe
 * across and feel boom boom boom, release on the one you want and it opens."
 *
 * Consolidated down from the prior 4-column grid's ~28 destinations to the
 * ones that have NO other way into them — see MENU_EXCLUDED_IDS below for
 * the removed items and where each one's real entry point now lives.
 *
 * Interaction:
 *  - A horizontal drag anywhere on the card area SCRUBS through the list —
 *    every CARD_SCRUB_STEP_PX (lib/studioCardCarousel.ts) of finger movement
 *    advances exactly one card, either direction, freely reversible. Each
 *    step is a quick ~90ms slide (never a bounce/spring). One strong haptic
 *    tick fires per card change, rate-limited so a very fast scrub still
 *    reads as a clean buzz rather than mush.
 *  - Lifting the finger (or a plain tap on the card) opens whatever card is
 *    currently shown, instantly: the sheet vanishes with no closing
 *    animation of its own, and the destination's own push animation is
 *    suppressed for this one navigation (see lib/navigationAnimationOverride.ts
 *    — Expo Router has no native per-call "animation: none", so the
 *    destination's own Stack.Screen reads a one-shot override instead).
 *  - A vertical drag (either direction on the card area, or the handle/
 *    header's own drag surface) dismisses the sheet without navigating,
 *    with the same rubber-band/velocity-flick feel as before. Horizontal vs.
 *    vertical is decided from the very first ~10px of movement (RNGH
 *    activeOffset/failOffset), so the two gestures never fight mid-drag.
 *  - Tapping the dimmed area above the sheet also dismisses without
 *    navigating.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { SHEET_EASING, SHEET_OPEN_MS, SHEET_CLOSE_MS } from '@/constants/motion';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { FONT, FS, RADIUS, SP, BREAKPOINT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { getSetupState, completionPercent } from '@/lib/setupStore';
import { setNextPushAnimationNone } from '@/lib/navigationAnimationOverride';
import { CARD_SCRUB_STEP_PX, indexForDrag } from '@/lib/studioCardCarousel';
import { PressableScale, SheetHandle } from '@/components/BrandthreadUI';
import {
  ALL_ITEMS,
  type ControlCenterItem,
} from '@/lib/sellerControlCenter';

export { ALL_ITEMS, SECTIONS, DEFAULT_PINNED_IDS } from '@/lib/sellerControlCenter';

// ─── Menu contents ────────────────────────────────────────────────────────────
// Dev's consolidation pass: the menu should only hold destinations with NO
// other way in. Everything below is EXCLUDED from the carousel because it
// already has a real, generally-visible entry point elsewhere — it stays
// fully reachable, just not from here (same treatment 'brand-memory' and
// 'help' already had):
//   orders          -> tab bar's own Orders tab
//   discounts       -> seller-settings' Discounts row (services/settingsCatalog.ts)
//   products        -> tab bar's own Products tab
//   post-video      -> the seller create FAB's "New post" entry
//   messages        -> the seller Profile tab's own Messages button
//   boost           -> the seller create FAB's "Start a boost" entry
//   store-preview   -> this sheet's OWN header "View store" button
//   subscription    -> seller-settings' Subscription row
//   store-builder   -> seller-settings' Store Builder row
//   shipping        -> seller-settings' Shipping row (and edit-profile.tsx)
//   team            -> seller-settings' Team and permissions row
//   settings        -> the seller Profile tab's gear icon (and this sheet's
//                      own header status pill)
//   help            -> this sheet's OWN header "?" icon, not the card list
// Kept regardless (Dev-named, no matter what else is true): go-live,
// analytics, payouts, community, taxes. Kept because nothing else reaches
// them: add-product (the dashboard's own "Add product" CTA is itself part
// of the seller-setup checklist flow, not a standing always-there button —
// Dev's own call to keep this one anyway), content, finance, manufacturer,
// customers, and the six Growth/Design Studio tools (app/(tabs)/studio.tsx
// links to the same six routes but is itself unreachable — href: null in
// the tab bar, and nothing anywhere pushes to it, so it doesn't count as a
// real duplicate entry point).
const MENU_EXCLUDED_IDS = [
  'orders', 'discounts', 'products', 'post-video', 'messages', 'boost',
  'store-preview', 'subscription', 'store-builder', 'shipping', 'team',
  'settings', 'help',
];
// Most-used first, per Dev — the rest of the catalog order doesn't matter
// once everything reachable elsewhere has already been excluded above.
const CARD_ORDER = [
  'add-product', 'go-live', 'analytics', 'payouts', 'community', 'taxes',
  'content', 'finance', 'manufacturer', 'customers',
  'design-studio', 'mockup-to-model', 'remove-bg', 'ai-design', 'campaign-gen', 'ai-photoshoot',
];
const CARD_ITEMS: ControlCenterItem[] = CARD_ORDER
  .map((id) => ALL_ITEMS.find((item) => item.id === id))
  .filter((i): i is ControlCenterItem => !!i);
if (__DEV__) {
  // Catch a rename/typo in CARD_ORDER or MENU_EXCLUDED_IDS immediately in
  // development rather than silently dropping (or double-counting) an item.
  const accounted = new Set([...CARD_ORDER, ...MENU_EXCLUDED_IDS]);
  const missing = ALL_ITEMS.filter((item) => !accounted.has(item.id));
  if (missing.length > 0) {
    console.warn(
      '[SellerStudioRadialMenu] Item(s) not in CARD_ORDER or MENU_EXCLUDED_IDS — ' +
      'unreachable from anywhere until sorted into one of the two: ' +
      missing.map((i) => i.id).join(', '),
    );
  }
}

/** How far apart two adjacent cards sit, as a fraction of the sheet's own
 *  width — small enough that a neighbor's icon edge is actually still
 *  inside the viewport (a card's own content is much narrower than the
 *  full screen width, so anything close to 1 here pushes neighbors
 *  entirely off-screen — verified against a live screenshot: 0.82 showed
 *  no peek at all). */
const CARD_SPACING_RATIO = 0.6;
/** Quick, no-bounce slide between cards on each scrub step or programmatic
 *  settle — matches the "quick 80-100ms slide, no bounce" spec. */
const CARD_STEP_MS = 90;
const CARD_STEP_EASING = Easing.out(Easing.cubic);
/** Minimum real time between two haptic calls, however many card-index
 *  crossings happen in between — keeps a very fast scrub a clean buzz
 *  instead of a mushy blur of overlapping vibrations. */
const MIN_HAPTIC_INTERVAL_MS = 45;
/** How many cards on each side of the current one stay mounted — enough for
 *  the peek effect and to never pop in in the middle of a fast scrub. */
const CARD_WINDOW_RADIUS = 2;

/** Rubber-band resistance for dragging the sheet up past its resting
 *  position — a diminishing-returns curve (never a hard clamp) that
 *  asymptotically approaches -(dim*c) however far past rest the finger
 *  travels. `value` is always <= 0 here (translateY dragged negative). */
function rubberBandUp(value: number, dim = 100, c = 0.55) {
  'worklet';
  const x = -value;
  return -((x * dim * c) / (dim + c * x));
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SellerStudioRadialMenuProps {
  hideTrigger?: boolean;
  openRequestKey?: number;
}

export default function SellerStudioRadialMenu({
  hideTrigger = false,
  openRequestKey = 0,
}: SellerStudioRadialMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= BREAKPOINT.tablet;
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, isTablet), [theme, isTablet]);
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const api = useApi();

  const { userId } = useAuth();

  // ~75% of the screen, per spec — a fixed ratio this time, not "as tall as
  // its content" (there IS no variable-height content anymore: one card at
  // a time is always the same shape, so there's no empty-band risk a
  // content-sized sheet was working around before).
  const sheetHeight = Math.min(screenHeight * 0.75, screenHeight - insets.top - 24);
  const cardSpacing = screenWidth * CARD_SPACING_RATIO;

  // Sheet transform + backdrop opacity, both UI-thread shared values —
  // translateY doubles as the "distance below resting position" the sheet
  // sits at, so 0 = fully open and `sheetHeight` = fully offscreen.
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);
  // Captured at the start of each drag so onUpdate computes an absolute
  // position from the gesture's cumulative translation, not a running delta.
  const dragStartY = useSharedValue(0);

  const [open, setOpen] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  const [brandName, setBrandName] = useState<string | null>(null);
  const [setupPercent, setSetupPercent] = useState(0);

  // ── Store header data — refreshed each time the sheet opens ────────────────

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSetupState().then((state) => {
      if (cancelled) return;
      setSetupPercent(completionPercent(state));
    });
    api.auth.me().then((profile: any) => {
      if (cancelled) return;
      setBrandName(profile?.brandName ?? profile?.displayName ?? profile?.name ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, api, userId]);

  useEffect(() => () => {
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
  }, [translateY, backdropOpacity]);

  // ── Card carousel state ─────────────────────────────────────────────────────
  // `cardIndex` is the UI-thread source of truth — a float that animates
  // (via withTiming) toward whatever integer index the current drag/tap
  // resolves to. `cardIndexJS` mirrors its ROUNDED value on the JS side,
  // updated only when it actually changes (see the reaction below), driving
  // the big name/position-indicator text and which cards are mounted at all
  // — Text content and mounting can't be driven from a worklet, unlike the
  // per-card transform/opacity styles, which read `cardIndex` directly.
  const cardIndex = useSharedValue(0);
  const gestureStartIndex = useSharedValue(0);
  const lastHapticIndexRef = useSharedValue(0);
  const lastHapticAtRef = useRef(0);
  const [cardIndexJS, setCardIndexJS] = useState(0);

  useEffect(() => {
    // Reset to the first card every time the sheet opens fresh, so it never
    // reopens wherever a previous session happened to leave off.
    if (open) {
      cardIndex.value = 0;
      gestureStartIndex.value = 0;
      lastHapticIndexRef.value = 0;
      setCardIndexJS(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fireHapticTick = useCallback(() => {
    const now = Date.now();
    if (now - lastHapticAtRef.current < MIN_HAPTIC_INTERVAL_MS) return;
    lastHapticAtRef.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  useAnimatedReaction(
    () => Math.round(cardIndex.value),
    (rounded, previous) => {
      if (rounded === previous) return;
      runOnJS(setCardIndexJS)(rounded);
      if (previous !== null) runOnJS(fireHapticTick)();
    },
  );

  // ── Open / close ────────────────────────────────────────────────────────────
  // A single fast timeline (never a spring — a spring's overshoot/settle
  // reads as a bounce, not the "swift and fast" slide Dev asked for) shared
  // by every way the sheet opens or closes: the initial expand, tapping the
  // backdrop, and the dismiss-swipe below. Release-to-select is deliberately
  // NOT part of this timeline — see commitAndOpen below, which closes with
  // no animation at all, per spec ("sheet gone in the same frame").

  const pendingAfterRef = useRef<(() => void) | null>(null);

  const finishClose = useCallback(() => {
    setOpen(false);
    const after = pendingAfterRef.current;
    pendingAfterRef.current = null;
    after?.();
  }, []);

  const hapticDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const expand = useCallback(() => {
    setOpen(true);
    translateY.value = sheetHeight;
    backdropOpacity.value = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    translateY.value = withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
    backdropOpacity.value = withTiming(1, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
  }, [translateY, backdropOpacity, sheetHeight]);

  useEffect(() => {
    if (openRequestKey > 0 && !open) expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestKey]);

  const collapse = useCallback((after?: () => void) => {
    pendingAfterRef.current = after ?? null;
    backdropOpacity.value = withTiming(0, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING });
    translateY.value = withTiming(sheetHeight, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [backdropOpacity, translateY, sheetHeight, finishClose]);

  /** Release-to-select / tap-to-select: no closing animation at all — the
   *  sheet is just gone, in the same frame the navigation fires, per spec
   *  ("no slide, fade or delay"). */
  const commitAndOpen = useCallback((item: ControlCenterItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
    setOpen(false);
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      item.growthOnly &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      setUpsellFeature(item.label);
      return;
    }
    setNextPushAnimationNone();
    router.push(item.route as never);
  }, [translateY, backdropOpacity, planLoading, planError, hasPlan, retryPlan, router]);

  // ── Gestures ─────────────────────────────────────────────────────────────────
  // Horizontal = scrub through cards, vertical = dismiss, near-zero movement
  // = tap-to-open. Two hard-won constraints from live web testing shaped
  // this:
  //  1. react-native-gesture-handler's web implementation (2.32.0) cannot
  //     resolve a Gesture.Race between two Gesture.Pan instances — attaching
  //     a second Pan alongside another (whether as a Race sibling, or
  //     nested in a separate GestureDetector one level up) made BOTH
  //     gestures cancel immediately on any real drag, regardless of their
  //     activeOffset/failOffset config. So scrub and dismiss are combined
  //     into ONE Gesture.Pan per detector that locks its own axis manually
  //     on the first ~10px of movement, rather than two Pans raced against
  //     each other.
  //  2. A genuine tap (zero movement) never activates a Gesture.Pan at all
  //     — it goes straight from BEGAN to FAILED without ever calling
  //     onStart/onEnd, on web or native, however its offsets are
  //     configured. So "release opens the current card" and "a plain tap
  //     also opens it" (spec points 5 and 6) need an actual Gesture.Tap,
  //     Raced against the combined Pan above — and that particular
  //     combination (exactly one Pan + one Tap) DOES resolve correctly on
  //     web, unlike two Pans.

  const commitAndOpenRef = useRef(commitAndOpen);
  commitAndOpenRef.current = commitAndOpen;
  const currentItemRef = useRef(CARD_ITEMS[0]);
  currentItemRef.current = CARD_ITEMS[cardIndexJS] ?? CARD_ITEMS[0];
  const openCurrentItem = useCallback(() => {
    commitAndOpenRef.current(currentItemRef.current);
  }, []);

  /** How far (in either single-axis direction) a drag must travel before its
   *  axis locks in — matches the "decide within the first ~10px" spec. */
  const AXIS_LOCK_PX = 10;
  const cardGestureAxis = useSharedValue<'none' | 'horizontal' | 'vertical'>('none');

  const runDismissEnd = useCallback((e: { translationY: number; velocityY: number }) => {
    'worklet';
    const shouldClose = e.translationY > sheetHeight * 0.25 || e.velocityY > 800;
    if (!shouldClose) {
      translateY.value = withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
      return;
    }
    runOnJS(hapticDismiss)();
    const remaining = sheetHeight - translateY.value;
    const velocityMs = e.velocityY > 0 ? (remaining / e.velocityY) * 1000 : SHEET_CLOSE_MS;
    const duration = Math.min(SHEET_CLOSE_MS, Math.max(90, velocityMs));
    backdropOpacity.value = withTiming(0, { duration, easing: SHEET_EASING });
    translateY.value = withTiming(sheetHeight, { duration, easing: SHEET_EASING }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [sheetHeight, translateY, backdropOpacity, hapticDismiss, finishClose]);

  // Header/handle: dismiss-only (vertical), or a plain tap on empty header
  // space also dismisses without navigating — this detector never scrubs.
  const dismissGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      dragStartY.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = dragStartY.value + e.translationY;
      translateY.value = next >= 0 ? next : rubberBandUp(next);
    })
    .onEnd((e) => {
      runDismissEnd(e);
    }), [translateY, dragStartY, runDismissEnd]);

  // Card area: scrub (horizontal) or dismiss (vertical) — a single combined
  // Pan that locks its own axis, per constraint 1 above.
  const cardAreaPan = useMemo(() => Gesture.Pan()
    .onBegin(() => {
      cardGestureAxis.value = 'none';
      gestureStartIndex.value = Math.round(cardIndex.value);
      dragStartY.value = translateY.value;
    })
    .onUpdate((e) => {
      if (cardGestureAxis.value === 'none') {
        if (Math.abs(e.translationX) > AXIS_LOCK_PX || Math.abs(e.translationY) > AXIS_LOCK_PX) {
          cardGestureAxis.value = Math.abs(e.translationX) >= Math.abs(e.translationY) ? 'horizontal' : 'vertical';
        }
      }
      if (cardGestureAxis.value === 'horizontal') {
        const next = indexForDrag(gestureStartIndex.value, e.translationX, CARD_ITEMS.length);
        cardIndex.value = withTiming(next, { duration: CARD_STEP_MS, easing: CARD_STEP_EASING });
      } else if (cardGestureAxis.value === 'vertical') {
        const next = dragStartY.value + e.translationY;
        translateY.value = next >= 0 ? next : rubberBandUp(next);
      }
    })
    .onEnd((e) => {
      if (cardGestureAxis.value === 'vertical') {
        runDismissEnd(e);
      } else if (cardGestureAxis.value === 'horizontal') {
        runOnJS(openCurrentItem)();
      }
      // axis === 'none' here means the Pan never crossed AXIS_LOCK_PX at
      // all before release — too small a movement for this Pan to have
      // even activated (see constraint 2), so it never reaches onEnd for
      // that case; the Race'd tapGesture below handles it instead.
    }), [cardIndex, gestureStartIndex, translateY, dragStartY, cardGestureAxis, runDismissEnd, openCurrentItem]);

  // A genuine tap (near-zero movement) — see constraint 2 above for why
  // this can't just be "the Pan's onEnd when its axis never locked".
  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDistance(AXIS_LOCK_PX)
    .onEnd(() => {
      runOnJS(openCurrentItem)();
    }), [openCurrentItem]);

  const cardAreaGesture = useMemo(
    () => Gesture.Race(cardAreaPan, tapGesture),
    [cardAreaPan, tapGesture],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // ── Derived data ────────────────────────────────────────────────────────────

  const isLocked = (item: ControlCenterItem) =>
    GROWTH_PLAN_ENFORCEMENT_ENABLED && !!item.growthOnly && !planLoading && !planError && !hasPlan('growth');

  const storeIsLive = setupPercent >= 100;

  // ── Card renderer ────────────────────────────────────────────────────────────
  // Every mounted card (the current one plus CARD_WINDOW_RADIUS neighbors on
  // each side) renders the same big icon + name; only its animated position/
  // scale/opacity (driven by `cardIndex`, on the UI thread) differ, which is
  // what makes the transition on each scrub step a smooth slide+crossfade
  // rather than a hard content swap.

  function CarouselCard({ item, itemIndex }: { item: ControlCenterItem; itemIndex: number }) {
    const locked = isLocked(item);
    const cardStyle = useAnimatedStyle(() => {
      const distance = itemIndex - cardIndex.value;
      const absDistance = Math.abs(distance);
      return {
        transform: [
          { translateX: distance * cardSpacing },
          { scale: interpolate(absDistance, [0, 1, 2], [1, 0.62, 0.48], Extrapolation.CLAMP) },
        ],
        opacity: interpolate(absDistance, [0, 0.999, 1, 2], [1, 1, 0.4, 0], Extrapolation.CLAMP),
      };
    });
    // pointerEvents="none": the whole card area's gesture (scrub/dismiss/
    // tap, composed in cardAreaGesture) handles all real touch input — an
    // individual card never receives its own touches, since which card is
    // "current" comes purely from cardIndex, not from which card a finger
    // happens to be over. accessibilityLabel/testID still identify it (for
    // a screen reader's swipe-navigation and this file's own tests / the
    // native device-interaction contract), even though a direct tap on a
    // non-center card doesn't select it the way the old grid's individual
    // pressable tiles did.
    return (
      <Animated.View
        key={item.id}
        style={[styles.card, cardStyle]}
        pointerEvents="none"
        accessibilityLabel={item.label}
        testID={`seller-control-center-item-${item.id}`}
      >
        <View style={styles.cardIconWrap}>
          <Feather name={item.icon as any} size={72} color={theme.text} />
          {locked && (
            <View style={styles.cardLock}>
              <Feather name="lock" size={14} color={theme.text} />
            </View>
          )}
        </View>
        <Text style={styles.cardLabel} numberOfLines={2}>{item.label}</Text>
      </Animated.View>
    );
  }

  const windowStart = Math.max(0, cardIndexJS - CARD_WINDOW_RADIUS);
  const windowEnd = Math.min(CARD_ITEMS.length - 1, cardIndexJS + CARD_WINDOW_RADIUS);
  const windowedItems: Array<{ item: ControlCenterItem; itemIndex: number }> = [];
  for (let i = windowStart; i <= windowEnd; i++) windowedItems.push({ item: CARD_ITEMS[i], itemIndex: i });

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {!hideTrigger && !open && (
        <Pressable
          testID="seller-studio-menu-open"
          accessibilityRole="button"
          accessibilityLabel="Open Studio tools"
          onPress={expand}
          style={({ pressed }) => [
            styles.toggle,
            { top: headerTopInset + SP.xl, backgroundColor: theme.accent, shadowColor: theme.shadowColor },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="grid" size={22} color={theme.onAccent} />
        </Pressable>
      )}

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => collapse()}
      >
        {/* Backdrop — solid, no translucency (theme.background is an opaque
            color; only its opacity is animated in as the sheet opens). */}
        <Animated.View
          testID="seller-studio-menu-backdrop"
          accessibilityLabel="Studio tools dark backdrop"
          style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}
          pointerEvents="none"
        />
        <Pressable
          testID="seller-studio-menu-dismiss"
          accessibilityLabel="Dismiss Studio tools backdrop"
          onPress={() => { hapticDismiss(); collapse(); }}
          style={StyleSheet.absoluteFill}
        />

        {/* Sheet handle/header and the card area are SIBLING GestureDetectors,
            each with its own single Gesture.Pan (dismissGesture,
            cardAreaGesture) — see the block comment above cardAreaGesture's
            definition for why neither is ever combined with another Pan via
            Gesture.Race, and why they're siblings rather than one nested
            inside the other. */}
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 16),
            },
            sheetAnimatedStyle,
          ]}
        >
          <GestureDetector gesture={dismissGesture}>
            <View>
              <SheetHandle />

              {/* ── Store header ── */}
              <View style={styles.header}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>{(brandName?.[0] ?? 'S').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName} numberOfLines={1}>{brandName ?? 'Your store'}</Text>
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); collapse(() => router.push('/settings' as never)); }}
                    hitSlop={{ top: 4, bottom: 4, left: 0, right: 4 }}
                  >
                    <Text style={[styles.statusPill, storeIsLive ? styles.statusLive : styles.statusSetup]}>
                      {storeIsLive ? 'Store live' : `${setupPercent}% set up`}
                    </Text>
                  </Pressable>
                </View>
                {/* Help & Support: not in the card list at all — see
                    MENU_EXCLUDED_IDS's own comment — reached only from here. */}
                <PressableScale
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); collapse(() => router.push('/help' as never)); }}
                  accessibilityRole="button"
                  accessibilityLabel="Help & Support"
                  testID="seller-control-center-item-help"
                  style={styles.helpBtn}
                >
                  <Feather name="help-circle" size={20} color={theme.text} />
                </PressableScale>
                <PressableScale
                  onPress={() => collapse(() => router.push('/store-preview' as never))}
                  accessibilityRole="button"
                  accessibilityLabel="View store"
                  style={styles.viewStoreBtn}
                >
                  <Feather name="external-link" size={13} color={theme.onAccent} />
                  <Text style={styles.viewStoreLabel}>View store</Text>
                </PressableScale>
              </View>
            </View>
          </GestureDetector>

          {/* ── Card carousel ── */}
          <GestureDetector gesture={cardAreaGesture}>
            <View style={styles.cardArea} testID="seller-studio-card-area">
              {windowedItems.map(({ item, itemIndex }) => (
                <CarouselCard key={item.id} item={item} itemIndex={itemIndex} />
              ))}
            </View>
          </GestureDetector>

          <Text style={styles.positionIndicator} testID="seller-studio-card-position">
            {cardIndexJS + 1} / {CARD_ITEMS.length}
          </Text>
        </Animated.View>
      </Modal>

      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => {
          setUpsellFeature(null);
          router.push('/subscription' as never);
        }}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: AppThemePreset, isTablet: boolean) => StyleSheet.create({
  toggle: {
    position: 'absolute',
    right: SP.md,
    zIndex: 1200,
    elevation: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },

  backdrop: { backgroundColor: theme.background },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.background,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    borderTopWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    maxWidth: isTablet ? 620 : undefined,
    alignSelf: isTablet ? 'center' : undefined,
    width: isTablet ? 620 : undefined,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  // Fixed: previously a solid grey (theme.accentDim) circle — Dev's own
  // report. Black fill + a thin silver ring reads as this app's own
  // black/white/silver identity instead of a generic filled avatar; the
  // initial is plain white, not accent-tinted.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.background,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  storeName: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  statusPill: {
    marginTop: 2,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    alignSelf: 'flex-start',
  },
  statusLive: { color: theme.success },
  statusSetup: { color: theme.accentLight },
  helpBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  viewStoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: theme.accent,
  },
  viewStoreLabel: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.onAccent },

  // ── Card carousel — one destination at a time, huge centered icon + name.
  // Absolutely-positioned/centered cards, offset purely via the animated
  // translateX in CarouselCard's own style — this View itself never scrolls.
  cardArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  card: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.md,
    paddingHorizontal: SP.xl,
  },
  cardIconWrap: { alignItems: 'center', justifyContent: 'center' },
  cardLabel: {
    fontSize: 28,
    fontFamily: FONT.bold,
    color: theme.text,
    textAlign: 'center',
    wordWrap: 'normal',
  },
  cardLock: {
    position: 'absolute',
    bottom: -6,
    right: -10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionIndicator: {
    textAlign: 'center',
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.muted,
    paddingBottom: SP.sm,
  },
});
