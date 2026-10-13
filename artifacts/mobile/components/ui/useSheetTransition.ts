/**
 * The shared sheet motion engine — see components/ui/BottomSheet.tsx's header
 * for the full spec. Lives in its own module (no keyboard / chrome imports)
 * so lightweight hosts like ActionSheet can use it directly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import {
  SHEET_CLOSE_MS, SHEET_EASING, SHEET_OFFSCREEN_Y, SHEET_RUBBER_BAND_LIMIT, SHEET_SPRING,
} from '@/constants/motion';

export interface SheetTransition {
  /** Whether the sheet's Modal should currently be mounted/shown. Stays true
   *  through the whole close animation and only flips false once it's done —
   *  drive `<Modal visible={modalVisible} ...>` (or an equivalent) from it. */
  modalVisible: boolean;
  /** Animated style for the sheet's translateY — apply to the sheet's outer
   *  `Animated.View`. */
  sheetStyle: AnimatedStyle<{ transform?: { translateY: number }[] }>;
  /** Animated style for the backdrop's opacity (0 → 1, derived from the
   *  sheet's position, so it tracks a drag too). Apply to the backdrop's
   *  `Animated.View`. */
  backdropStyle: AnimatedStyle<{ opacity: number }>;
  /** Pan gesture for swipe-to-close: attach via `<GestureDetector gesture={panGesture}>`
   *  around the sheet's outer `Animated.View` (or a drag-handle region of it). */
  panGesture: ReturnType<typeof Gesture.Pan>;
  /** Attach to the sheet's outer `Animated.View`'s `onLayout` so the pan
   *  gesture's dismiss threshold (25% of the sheet's actual rendered
   *  height) is measured, not guessed. */
  onSheetLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
  /** Scroll offset of the sheet's body, when the body scrolls. A drag only
   *  moves the sheet while the body is scrolled to the top. */
  scrollOffset: SharedValue<number>;
  /** Whether the body's content is taller than its viewport. While it is, an
   *  upward drag scrolls the body instead of rubber-banding the sheet. */
  bodyOverflows: SharedValue<boolean>;
  detent: SheetDetent;
  contentScrollEnabled: boolean;
  footerStyle: AnimatedStyle<{ transform?: { translateY: number }[] }>;
}

export type SheetDetent = 'half' | 'full';
export const SHEET_HALF_FRACTION = 0.55;

/**
 * Drives a sheet's open/close transform + backdrop opacity, and its
 * swipe-to-close gesture, all on the UI thread. `onClosed` fires exactly
 * once the close animation has finished — never before, never twice, and
 * never if the animation is interrupted by another `visible` flip.
 */
export function useSheetTransition(
  visible: boolean,
  onClosed: () => void,
  opts?: {
    closeDistance?: number; reduceMotion?: boolean | null; haptics?: boolean;
    detents?: { fullHeight: number; halfHeight?: number; initial?: SheetDetent };
  },
): SheetTransition {
  // Falls back to the window's own height (never a measured sheet height,
  // which is 0 before first layout) with the SHEET_OFFSCREEN_Y floor, so a
  // very short window still gets comfortable offscreen clearance.
  const closeDistance = opts?.closeDistance ?? Math.max(Dimensions.get('window').height, SHEET_OFFSCREEN_Y);
  const systemReduceMotion = useReducedMotion();
  const reduceMotion = !!opts?.reduceMotion || systemReduceMotion;
  const haptics = opts?.haptics !== false;
  const detents = opts?.detents;
  const halfOffset = detents
    ? Math.max(0, detents.fullHeight - (detents.halfHeight ?? Math.round(Dimensions.get('window').height * SHEET_HALF_FRACTION)))
    : 0;
  const openY = detents && (detents.initial ?? 'half') === 'half' ? halfOffset : 0;
  const [detent, setDetent] = useState<SheetDetent>(detents?.initial ?? 'half');
  const translateY = useSharedValue(closeDistance);
  const scrollOffset = useSharedValue(0);
  const bodyOverflows = useSharedValue(false);
  const [modalVisible, setModalVisible] = useState(visible);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  // True from the moment the sheet starts opening until its close finishes.
  // Guards the close path so a swipe-dismiss followed by the parent flipping
  // `visible` false doesn't run the close (and fire `onClosed`) twice.
  const openRef = useRef(false);

  const finishClose = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setModalVisible(false);
    onClosedRef.current();
  }, []);

  const dismissHaptic = useCallback(() => { if (haptics) hapticLight(); }, [haptics]);
  const snapHaptic = useCallback(() => { if (haptics) hapticSelection(); }, [haptics]);

  // Under Reduce Motion the sheet still moves (a bare value write can leave a
  // stale transform painted on web — see the regression test), just on a
  // short timing curve instead of a spring.
  const toRest = (velocity = 0) => (reduceMotion
    ? withTiming(openY, { duration: 150, easing: SHEET_EASING })
    : withSpring(openY, { ...SHEET_SPRING, velocity }));

  useEffect(() => {
    if (visible) {
      const wasOpen = openRef.current;
      openRef.current = true;
      setModalVisible(true);
      if (detents) setDetent(detents.initial ?? 'half');
      if (!wasOpen && haptics) hapticLight();
      scrollOffset.set(0);
      // Always animated — never a bare `.set(0)`: on web a one-off value
      // write can update the shared value without Reanimated pushing the
      // matching DOM style patch, leaving the sheet stuck offscreen.
      translateY.set(toRest());
      return;
    }
    if (!openRef.current) return;
    if (haptics) hapticLight();
    // Closing: keep the Modal mounted until the transform finishes; nothing
    // unmounts or clears caller state until `finished` is true. Exits run
    // ~30% faster than the open.
    translateY.set(
      withTiming(closeDistance, { duration: reduceMotion ? 150 : SHEET_CLOSE_MS, easing: SHEET_EASING }, finished => {
        'worklet';
        if (finished) runOnJS(finishClose)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Measured via onSheetLayout below; falls back to closeDistance (a generous
  // over-estimate) until the first layout so an extremely early drag still
  // has a sane threshold rather than reading as `0 * 0.25 = 0` (always closes).
  const sheetHeight = useSharedValue(closeDistance);
  // An always-present transform key (even an identity one) — RN Web's DOM
  // patcher doesn't reliably clear a transform when a later style omits it.
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, Math.min(translateY.value, halfOffset)) }],
  }));
  // Backdrop opacity follows the sheet's position over the sheet's own height,
  // so it fades in sync on open, close and mid-drag.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [0, Math.max(1, Math.min(sheetHeight.value, closeDistance))],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const dragStartY = useSharedValue(0);
  // Whether this drag is moving the sheet (vs. scrolling its body).
  const dragging = useSharedValue(false);

  const onSheetLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0) sheetHeight.set(height);
  }, [sheetHeight]);

  const panGesture = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-20, 20])
    .onStart(() => {
      dragStartY.set(translateY.value);
      dragging.set(!!detents && translateY.value > 0 || scrollOffset.value <= 0);
    })
    .onUpdate(e => {
      if (!dragging.value) {
        // Body was scrolled when the drag began: hand over to the sheet only
        // once the body is back at the top and the finger moves down.
        if (scrollOffset.value > 0 || e.translationY <= 0) return;
        dragging.set(true);
        dragStartY.set(translateY.value - e.translationY);
      }
      const next = dragStartY.value + e.translationY;
      if (next < 0 && bodyOverflows.value) {
        // Pulling up on a body that scrolls: the body takes it.
        translateY.set(Math.max(translateY.value, 0));
        dragging.set(false);
        return;
      }
      if (next >= 0) {
        translateY.set(next);
      } else {
        // Rubber-band: resistance grows the further up it's pulled.
        const over = -next;
        translateY.set(-SHEET_RUBBER_BAND_LIMIT * (1 - 1 / (over / SHEET_RUBBER_BAND_LIMIT * 0.55 + 1)));
      }
    })
    .onEnd(e => {
      if (!dragging.value) return;
      dragging.set(false);
      const dismissLine = detents
        ? halfOffset + (detents.fullHeight - halfOffset) * 0.25
        : sheetHeight.value * 0.25;
      const shouldClose = translateY.value > 0
        && (translateY.value > dismissLine || e.velocityY > 800 && (!detents || translateY.value >= halfOffset));
      if (shouldClose) {
        runOnJS(dismissHaptic)();
        translateY.set(
          withSpring(closeDistance, { ...SHEET_SPRING, velocity: e.velocityY }, finished => {
            'worklet';
            if (finished) runOnJS(finishClose)();
          }),
        );
      } else {
        if (Math.abs(translateY.value) > 2) runOnJS(snapHaptic)();
        const target = detents
          ? (e.velocityY < -400 ? 0 : e.velocityY > 400 ? halfOffset : translateY.value < halfOffset * 0.5 ? 0 : halfOffset)
          : 0;
        if (detents) runOnJS(setDetent)(target === 0 ? 'full' : 'half');
        translateY.set(reduceMotion
          ? withTiming(target, { duration: 150, easing: SHEET_EASING })
          : withSpring(target, { ...SHEET_SPRING, velocity: e.velocityY }));
      }
    });

  return {
    modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout, scrollOffset, bodyOverflows,
    detent, contentScrollEnabled: !detents || detent === 'full', footerStyle,
  };
}

