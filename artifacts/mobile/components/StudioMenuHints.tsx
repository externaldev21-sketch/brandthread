/**
 * The two swipe affordances that float over the Studio menu's full-bleed
 * card carousel (components/SellerStudioRadialMenu.tsx), replacing the old
 * row of position dots at the bottom:
 *
 *  - <StudioEdgeChevrons> — a persistent, tiny ‹ › pair pinned to the left
 *    and right screen edges at mid-height (inside the safe area, same 8pt
 *    inset as the edge-trace). Silver at ~35%, never intercepting touches.
 *    Idle: every ~4s they drift 2-3pt outward and back. While the user
 *    drags: the chevron in the drag direction brightens to ~90% and
 *    stretches with drag progress, the other fades. Each one hides at its
 *    end of the (non-looping) list: ‹ on the first card, › on the last.
 *
 *  - <StudioSwipeCoach> — the first-time coach mark: a full-screen black
 *    scrim at ~70% (Dev explicitly approved translucency for THIS overlay
 *    only), an animated hand glyph swiping left-right across the middle
 *    and three words. Fades in/out over 200ms. It never takes a touch
 *    itself (pointerEvents none) — the menu's own gestures dismiss it (a
 *    tap, or the first swipe, which still scrubs through) so the user's
 *    first real gesture is also the one that teaches it.
 *
 * Reskinned from Mobbin's first-run swipe coach marks — Quizlet's
 * "Swipe right or left to preview more sets" (a hand glyph between two
 * arrows over a dimmed screen,
 * https://mobbin.com/screens/f8125705-5ed4-4f31-8b95-70a1fed3b227) and
 * Uber Eats' / TikTok's "Swipe up" hand-on-dimmed-screen marks
 * (https://mobbin.com/screens/caaeaafa-eb83-4580-be9e-aaee2f9e0183,
 * https://mobbin.com/screens/70fe8052-9db7-4321-9c6d-51d70e362c2e) — into
 * this app's black/white/silver + Inter, without their "Got it" buttons
 * (Dev: no filler; the gesture itself dismisses).
 *
 * Everything animates on the UI thread (Reanimated). Reduce Motion: the
 * chevrons skip their idle drift (the drag response stays — it's live
 * feedback, not decoration) and the coach hand renders static.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { FONT } from '@/lib/theme';

// ─── Edge chevrons ────────────────────────────────────────────────────────────

/** Glyph size — Dev: "~7-9px". Feather's chevron glyph fills its box edge
 *  to edge horizontally at this size. */
export const EDGE_CHEVRON_SIZE = 9;
/** Resting opacity (silver ~35%) and the fully-brightened drag opacity. */
export const EDGE_CHEVRON_IDLE_OPACITY = 0.35;
export const EDGE_CHEVRON_ACTIVE_OPACITY = 0.9;
/** How far each chevron drifts outward on its idle breath, and how often. */
export const EDGE_CHEVRON_IDLE_DRIFT_PX = 2.5;
export const EDGE_CHEVRON_IDLE_PERIOD_MS = 4000;
const EDGE_CHEVRON_IDLE_DRIFT_MS = 420;
/** Horizontal stretch at full drag progress (one full card's worth of drag). */
const EDGE_CHEVRON_MAX_STRETCH = 0.45;
/** Silver — the app's own border/silver tone (lib/theme.ts), full alpha;
 *  opacity is animated separately so the colour itself never changes. */
const SILVER = '#C7CDD5';

export interface StudioEdgeChevronsProps {
  /** The carousel's live (float) index — hides ‹ at 0 and › at the last card. */
  cardIndex: SharedValue<number>;
  /** Number of cards; the list does not loop. */
  cardCount: number;
  /** Live horizontal drag translation (px) while the user scrubs, 0 when
   *  not dragging. Finger moving LEFT (negative) advances to the next card,
   *  so it is the RIGHT chevron that brightens for a negative value. */
  dragX: SharedValue<number>;
  /** Pixels of drag per card step — drag progress saturates at one step. */
  dragPxPerCard: number;
  /** Safe-area left/right insets — the chevrons sit 8pt inside them. */
  insetLeft: number;
  insetRight: number;
  reduceMotion: boolean;
}

/** Same 8pt inset as the edge-trace (TRACE_INSET), so the two hug the
 *  screen edge identically. */
const EDGE_INSET = 8;

function EdgeChevron({
  side, cardIndex, cardCount, dragX, dragPxPerCard, idle, reduceMotion,
}: {
  side: 'left' | 'right';
  cardIndex: SharedValue<number>;
  cardCount: number;
  dragX: SharedValue<number>;
  dragPxPerCard: number;
  idle: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const style = useAnimatedStyle(() => {
    // Progress of the current drag TOWARD this chevron's side, 0..1 over
    // one card step. Finger left (dragX < 0) → next card → right chevron.
    const toward = side === 'right' ? -dragX.value : dragX.value;
    const progress = interpolate(toward, [0, dragPxPerCard], [0, 1], Extrapolation.CLAMP);
    // The OTHER chevron's progress — this one fades while that one brightens.
    const away = interpolate(-toward, [0, dragPxPerCard], [0, 1], Extrapolation.CLAMP);
    // Hidden at the list's own end: ‹ on the first card, › on the last.
    // Fades over the final half-card of travel so it never pops.
    const last = Math.max(0, cardCount - 1);
    const available = side === 'left'
      ? interpolate(cardIndex.value, [0, 0.5], [0, 1], Extrapolation.CLAMP)
      : interpolate(last - cardIndex.value, [0, 0.5], [0, 1], Extrapolation.CLAMP);
    const opacity = available * (
      EDGE_CHEVRON_IDLE_OPACITY * (1 - away)
      + (EDGE_CHEVRON_ACTIVE_OPACITY - EDGE_CHEVRON_IDLE_OPACITY) * progress
    );
    // Idle breath: outward (away from the screen centre) and back.
    const drift = reduceMotion ? 0 : idle.value * EDGE_CHEVRON_IDLE_DRIFT_PX;
    const outward = side === 'left' ? -drift : drift;
    return {
      opacity,
      transform: [
        { translateX: outward },
        { scaleX: 1 + EDGE_CHEVRON_MAX_STRETCH * progress },
      ],
    };
  });
  return (
    <Animated.View
      style={[styles.chevron, style]}
      pointerEvents="none"
      testID={`seller-studio-edge-chevron-${side}`}
    >
      <Feather name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={EDGE_CHEVRON_SIZE} color={SILVER} />
    </Animated.View>
  );
}

export function StudioEdgeChevrons({
  cardIndex, cardCount, dragX, dragPxPerCard, insetLeft, insetRight, reduceMotion,
}: StudioEdgeChevronsProps) {
  // 0 at rest, 1 fully drifted outward — one shared breath for both sides.
  const idle = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) { idle.value = 0; return; }
    const rest = Math.max(0, EDGE_CHEVRON_IDLE_PERIOD_MS - 2 * EDGE_CHEVRON_IDLE_DRIFT_MS);
    idle.value = withRepeat(
      withSequence(
        withDelay(rest, withTiming(1, { duration: EDGE_CHEVRON_IDLE_DRIFT_MS, easing: Easing.inOut(Easing.quad) })),
        withTiming(0, { duration: EDGE_CHEVRON_IDLE_DRIFT_MS, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => { cancelAnimation(idle); idle.value = 0; };
  }, [idle, reduceMotion]);

  const shared = { cardIndex, cardCount, dragX, dragPxPerCard, idle, reduceMotion };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="seller-studio-edge-chevrons">
      <View style={[styles.chevronRail, { left: insetLeft + EDGE_INSET }]} pointerEvents="none">
        <EdgeChevron side="left" {...shared} />
      </View>
      <View style={[styles.chevronRail, { right: insetRight + EDGE_INSET }]} pointerEvents="none">
        <EdgeChevron side="right" {...shared} />
      </View>
    </View>
  );
}

// ─── First-time swipe coach ───────────────────────────────────────────────────

export const COACH_FADE_MS = 200;
/** Dev-approved scrim: black at ~70%. */
export const COACH_SCRIM_COLOR = 'rgba(0,0,0,0.7)';
export const COACH_COPY = 'Swipe to switch';
/** How far the hand travels each way, and one full left→right→left cycle. */
const COACH_HAND_TRAVEL_PX = 34;
const COACH_HAND_HALF_CYCLE_MS = 700;
const COACH_HAND_PAUSE_MS = 260;

export interface StudioSwipeCoachProps {
  visible: boolean;
  reduceMotion: boolean;
}

/**
 * Stays mounted through its 200ms fade-out, then unmounts itself — so a
 * dismiss never hard-cuts the scrim. Nothing here is pressable: the menu's
 * own gestures own dismissal (see SellerStudioRadialMenu's tapGesture /
 * cardAreaPan), so the first swipe still scrubs through underneath.
 */
export function StudioSwipeCoach({ visible, reduceMotion }: StudioSwipeCoachProps) {
  const [mounted, setMounted] = useState(visible);
  const opacity = useSharedValue(0);
  // -1 (left) … 1 (right): the hand's position along its swipe.
  const hand = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      cancelAnimation(opacity);
      opacity.value = withTiming(1, { duration: COACH_FADE_MS, easing: Easing.out(Easing.quad) });
      return;
    }
    cancelAnimation(opacity);
    opacity.value = withTiming(0, { duration: COACH_FADE_MS, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [visible, opacity]);

  useEffect(() => {
    if (!mounted || reduceMotion) { hand.value = 0; return; }
    hand.value = -1;
    hand.value = withRepeat(
      withSequence(
        withTiming(1, { duration: COACH_HAND_HALF_CYCLE_MS, easing: Easing.inOut(Easing.cubic) }),
        withDelay(COACH_HAND_PAUSE_MS, withTiming(-1, { duration: COACH_HAND_HALF_CYCLE_MS, easing: Easing.inOut(Easing.cubic) })),
        withDelay(COACH_HAND_PAUSE_MS, withTiming(-1, { duration: 1 })),
      ),
      -1,
      false,
    );
    return () => { cancelAnimation(hand); hand.value = 0; };
  }, [mounted, reduceMotion, hand]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const handStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: hand.value * COACH_HAND_TRAVEL_PX },
      // A touch of lift at each end of the swipe so it reads as a finger
      // pressing down mid-travel, not a sliding sticker.
      { translateY: -3 * (1 - Math.abs(hand.value)) },
    ],
  }));
  // The track under the hand: a faint silver line with the two swipe
  // directions, so the motion reads even in a single frame (and under
  // Reduce Motion, where the hand is static).
  const trackStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(hand.value), [0, 1], [0.5, 0.9]),
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.coachRoot, scrimStyle]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      testID="seller-studio-swipe-coach"
    >
      <View style={styles.coachCenter} pointerEvents="none">
        <View style={styles.coachGlyphRow}>
          <Animated.View style={[styles.coachTrack, trackStyle]}>
            <Feather name="chevron-left" size={14} color={SILVER} />
            <View style={styles.coachTrackLine} />
            <Feather name="chevron-right" size={14} color={SILVER} />
          </Animated.View>
          <Animated.View style={[styles.coachHand, handStyle]}>
            <MaterialCommunityIcons name="gesture-swipe-horizontal" size={56} color="#FFFFFF" />
          </Animated.View>
        </View>
        <Text style={styles.coachCopy} accessibilityRole="text">{COACH_COPY}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chevronRail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  chevron: {
    width: EDGE_CHEVRON_SIZE,
    height: EDGE_CHEVRON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  coachRoot: {
    backgroundColor: COACH_SCRIM_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the header/X (the scrim is meant to cover everything) and the
    // trace Svg's own zIndex: 1.
    zIndex: 20,
    elevation: 20,
  },
  coachCenter: {
    alignItems: 'center',
    gap: 18,
  },
  coachGlyphRow: {
    width: 180,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  coachTrackLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: SILVER,
    opacity: 0.6,
  },
  coachHand: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachCopy: {
    color: '#FFFFFF',
    fontFamily: FONT.semibold,
    fontSize: 17,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
});
