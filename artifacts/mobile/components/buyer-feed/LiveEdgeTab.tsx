/**
 * Buyer Threads Home — LIVE edge tab.
 *
 * LIVE no longer sits in the header row. It's a slim pill docked on the
 * LEFT screen edge at header height, mostly tucked off-screen with just the
 * red live dot peeking out. Tap it (or drag it right) and it slides out into
 * the full LIVE button, physically shoving the header Cart aside: the Cart
 * slides right, fades and scales out, and stops taking touches until LIVE
 * tucks back in.
 *
 * Collapses on: dragging it back toward the edge, a tap anywhere else (a
 * transparent full-screen catcher swallows that tap — it does not reach the
 * video underneath), scrolling the feed, leaving the screen, or opening Live.
 *
 * Everything moves on the UI thread: one shared `progress` value (0 tucked,
 * 1 out) drives the pill, its contents and the Cart push, so they can't
 * drift out of step. No layout props are animated, only transforms/opacity.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { hapticLight } from '@/lib/haptics';
import { ON_DARK } from '@/lib/theme';

/** Full width of the expanded LIVE button. */
export const LIVE_EDGE_WIDTH = 84;
const LIVE_EDGE_HEIGHT = 32;
/** How much of the tucked pill peeks in from the screen edge. */
const LIVE_EDGE_PEEK = 22;
/** Gap between the expanded LIVE button and the pushed Cart. */
const PUSH_GAP = 10;

// ~250ms, critically damped enough that nothing overshoots past the edge.
const SPRING = { duration: 250, dampingRatio: 0.92 } as const;

export type LiveEdgeTabController = {
  progress: SharedValue<number>;
  open: boolean;
  setOpen: (next: boolean) => void;
  collapse: () => void;
};

/**
 * Owns the LIVE tab's open state + its UI-thread progress. Lives in the
 * screen so both the tab and the Cart push read the same shared value.
 */
export function useLiveEdgeTab(): LiveEdgeTabController {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const [open, setOpenState] = useState(false);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    progress.set(reduceMotion ? (next ? 1 : 0) : withSpring(next ? 1 : 0, SPRING));
    if (next) hapticLight();
  }, [progress, reduceMotion]);

  const collapse = useCallback(() => {
    setOpenState(false);
    progress.set(reduceMotion ? 0 : withSpring(0, SPRING));
  }, [progress, reduceMotion]);

  return { progress, open, setOpen, collapse };
}

export function LiveEdgeTab({
  controller,
  top,
  leftInset,
  gutter,
  onOpenLive,
}: {
  controller: LiveEdgeTabController;
  /** Screen y of the header row's vertical center. */
  top: number;
  /** Safe-area left inset (landscape / iPad), 0 on portrait iPhone. */
  leftInset: number;
  /** Where the expanded button's left edge lands — the header's side gutter. */
  gutter: number;
  onOpenLive: () => void;
}) {
  const { progress, open, setOpen, collapse } = controller;
  const tuckedX = -(LIVE_EDGE_WIDTH - LIVE_EDGE_PEEK);
  const outX = leftInset + gutter;
  const travel = outX - tuckedX;

  const dragStart = useSharedValue(0);

  const openLive = useCallback(() => {
    collapse();
    onOpenLive();
  }, [collapse, onOpenLive]);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      dragStart.value = progress.value;
    })
    .onUpdate((e) => {
      const next = dragStart.value + e.translationX / travel;
      progress.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((e) => {
      const shouldOpen = e.velocityX > 300 || (e.velocityX > -300 && progress.value > 0.5);
      runOnJS(setOpen)(shouldOpen);
    });

  const tap = Gesture.Tap()
    .maxDuration(400)
    .onEnd((_e, success) => {
      if (!success) return;
      if (progress.value > 0.5) runOnJS(openLive)();
      else runOnJS(setOpen)(true);
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tuckedX + travel * progress.value }],
  }));
  // Tucked: just the dot, pinned to the pill's visible right end.
  const tuckedContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35], [1, 0], Extrapolation.CLAMP),
  }));
  // Out: icon + LIVE label.
  const outContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.8], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {open && (
        // Tap-outside catcher: closes and does NOT let the tap through.
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapse}
          accessibilityRole="button"
          accessibilityLabel="Close Live"
          testID="buyer-home-live-catcher"
        />
      )}
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.pill, { top: top - LIVE_EDGE_HEIGHT / 2 }, pillStyle]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={open ? 'Watch Live' : 'Show Live'}
          accessibilityHint={open ? undefined : 'Slides out the Live button'}
          accessibilityState={{ expanded: open }}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 10 }}
          testID="buyer-home-live"
        >
          <Animated.View style={[styles.tuckedContent, tuckedContentStyle]} pointerEvents="none">
            <View style={styles.dot} />
          </Animated.View>
          <Animated.View style={[styles.outContent, outContentStyle]} pointerEvents="none">
            <View style={styles.dot} />
            <Feather name="tv" size={15} color={ON_DARK} />
            <Text style={styles.label} maxFontSizeMultiplier={1.2}>LIVE</Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Wraps the header Cart: as LIVE slides out it pushes the Cart right by
 * exactly the overlap, fading + scaling it out, and the Cart stops taking
 * touches while hidden. Springs straight back when LIVE tucks in.
 */
export function LiveCartPush({
  controller,
  cartX,
  leftInset,
  gutter,
  children,
}: {
  controller: LiveEdgeTabController;
  /** Cart's resting left edge, measured from the header's padded left edge. */
  cartX: number;
  leftInset: number;
  gutter: number;
  children: React.ReactNode;
}) {
  const { progress, open } = controller;
  // Screen x of the expanded LIVE button's right edge vs the cart's resting
  // screen x — the cart moves by just enough to clear it.
  const pushX = Math.max(0, leftInset + gutter + LIVE_EDGE_WIDTH + PUSH_GAP - (leftInset + gutter + cartX));
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.7], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: pushX * progress.value },
      { scale: interpolate(progress.value, [0, 1], [1, 0.6], Extrapolation.CLAMP) },
    ],
  }));
  return (
    <Animated.View
      style={style}
      pointerEvents={open ? 'none' : 'auto'}
      accessibilityElementsHidden={open}
      importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 0,
    width: LIVE_EDGE_WIDTH,
    height: LIVE_EDGE_HEIGHT,
    borderRadius: LIVE_EDGE_HEIGHT / 2,
    // Solid fill, no BlurView: a live blur over the playing video
    // re-samples it every frame (see FeedTopBar / ShopSideTab).
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  tuckedContent: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: (LIVE_EDGE_PEEK - 7) / 2,
  },
  outContent: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FF3B30' },
  label: { color: ON_DARK, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
});
