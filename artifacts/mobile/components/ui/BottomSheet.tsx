/**
 * Brandthread Design System — BottomSheet (Phase 1 → Phase 2: shared sheet
 * transition primitive)
 *
 * `useSheetTransition` is the ONE animation/dismissal engine every bottom
 * sheet in the app should use — Reanimated (UI-thread) only, a single close
 * timeline for the sheet transform + backdrop fade, a swipe-to-close pan
 * gesture (velocity-based dismissal) that also stays on the UI thread, and a
 * `finished`-gated close callback so the caller never unmounts/clears state
 * before the close animation has actually finished (the exact race that
 * produced the "stops a quarter of the way, then jumps the rest of the way"
 * Shop-the-Post close glitch: a legacy JS-thread `Animated.timing` sharing
 * the same thread as React re-renders can stall mid-flight and then jump to
 * catch up to its time-based target).
 *
 * `<BottomSheet>` below is the simple, generic sheet (grabber handle, dimmed
 * backdrop, keyboard-aware content) built on top of the hook, for anything
 * simpler than a bespoke sheet with its own header/chrome (ShopProductSheet,
 * VariantPickerSheet, SaveToCollectionSheet, …). Those sheets use
 * `useSheetTransition` directly so they keep their own layout while sharing
 * the exact same motion engine.
 *
 * Layout/interaction reference only: UNIQLO "Added to cart" sheet.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { a11yModalProps } from '@/lib/a11y/modal';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';
import {
  SHEET_CLOSE_MS, SHEET_EASING, SHEET_OFFSCREEN_Y, SHEET_OPEN_MS,
} from '@/constants/motion';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';

export interface SheetTransition {
  /** Whether the sheet's Modal should currently be mounted/shown. Stays true
   *  through the whole close animation and only flips false once it's done —
   *  drive `<Modal visible={modalVisible} ...>` (or an equivalent) from it. */
  modalVisible: boolean;
  /** Animated style for the sheet's translateY — apply to the sheet's outer
   *  `Animated.View`. */
  sheetStyle: AnimatedStyle<{ transform?: { translateY: number }[] }>;
  /** Animated style for the backdrop's opacity — apply to the backdrop's
   *  `Animated.View`, on the exact same timeline as `sheetStyle`. */
  backdropStyle: AnimatedStyle<{ opacity: number }>;
  /** Pan gesture for swipe-to-close: attach via `<GestureDetector gesture={panGesture}>`
   *  around the sheet's outer `Animated.View` (or a drag-handle region of it). */
  panGesture: ReturnType<typeof Gesture.Pan>;
  /** Attach to the sheet's outer `Animated.View`'s `onLayout` so the pan
   *  gesture's dismiss threshold (25% of the sheet's actual rendered
   *  height) is measured, not guessed — a fixed pixel threshold felt wrong
   *  on a short sheet and too lenient on a tall one. */
  onSheetLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
  /** Only with `opts.detents`: which detent the sheet rests at right now. */
  detent: SheetDetent;
  /** Only with `opts.detents`: true once the content may scroll (full
   *  detent) — at the half detent a drag on the content moves the sheet,
   *  exactly like Apple Maps / Instagram comments. */
  contentScrollEnabled: boolean;
  /** Feed the content ScrollView's `onScroll` y offset here so a downward
   *  drag at the full detent only pulls the sheet once the list is at top. */
  onContentScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  /** Only with `opts.detents`: wrap the content ScrollView in
   *  `<GestureDetector gesture={scrollGesture}>` so it scrolls alongside the
   *  sheet's pan instead of fighting it. */
  scrollGesture: ReturnType<typeof Gesture.Native>;
}

/** Half rests at ~55% of the screen like Instagram comments; full stops just
 *  under the status bar, like an iOS large-detent sheet. */
export type SheetDetent = 'half' | 'full';
export const SHEET_HALF_FRACTION = 0.55;

/**
 * Drives a sheet's open/close transform + backdrop opacity, and its
 * swipe-to-close gesture, all on the UI thread. `onClosed` fires exactly
 * once the close animation has finished — never before, and never if the
 * animation is interrupted by another `visible` flip.
 */
export function useSheetTransition(
  visible: boolean,
  onClosed: () => void,
  opts?: {
    closeDistance?: number;
    reduceMotion?: boolean | null;
    /** Opt-in half/full detents. Pass the sheet's full height (the height of
     *  the sheet at its `full` detent); the sheet opens at `half`. Sheets
     *  that don't pass this keep the original fit-to-content behaviour. */
    detents?: { fullHeight: number; halfHeight?: number; initial?: SheetDetent };
  },
): SheetTransition {
  // Falls back to the window's own height (never a measured sheet height —
  // this must be independent of `onSheetLayout`/`sheetHeight` below, which
  // only ever feeds the swipe-dismiss threshold) union'd with the fixed
  // SHEET_OFFSCREEN_Y floor, so a very short window still gets comfortable
  // offscreen clearance.
  const closeDistance = opts?.closeDistance ?? Math.max(Dimensions.get('window').height, SHEET_OFFSCREEN_Y);
  const reduceMotion = !!opts?.reduceMotion;
  const translateY = useSharedValue(closeDistance);
  const backdropOpacity = useSharedValue(0);
  const detents = opts?.detents;
  // translateY at the half detent (full detent rests at 0).
  const halfOffset = detents
    ? Math.max(0, detents.fullHeight - (detents.halfHeight ?? Math.round(Dimensions.get('window').height * SHEET_HALF_FRACTION)))
    : 0;
  const openY = detents && (detents.initial ?? 'half') === 'half' ? halfOffset : 0;
  const [detent, setDetent] = useState<SheetDetent>(detents?.initial ?? 'half');
  const contentOffsetY = useSharedValue(0);
  const [modalVisible, setModalVisible] = useState(visible);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      if (detents) setDetent(detents.initial ?? 'half');
      // Always animate via `withTiming` on the shared SHEET_TIMING curve —
      // never a bare `.set()`/`.value =` jump straight to the target, even
      // under reduceMotion. On web, a one-off synchronous value write with
      // nothing else scheduling a frame after it can update the JS-side
      // shared-value store without Reanimated ever pushing the matching DOM
      // style patch, leaving the sheet permanently stuck at its *previous*
      // transform (fully offscreen) even though the computed style is
      // already correct — this was the "Shop the Post never opens" web
      // regression. `withTiming` always goes through the same rAF-driven
      // commit path a running animation uses, so the DOM reliably updates;
      // 260ms is short enough that reduceMotion users aren't meaningfully
      // affected by keeping it animated rather than instant.
      backdropOpacity.set(withTiming(1, { duration: SHEET_OPEN_MS, easing: SHEET_EASING }));
      translateY.set(withTiming(openY, { duration: SHEET_OPEN_MS, easing: SHEET_EASING }));
      return;
    }
    // Closing: keep the Modal mounted until the transform finishes — this is
    // the single close timeline (sheet + backdrop share duration/easing), and
    // nothing unmounts or clears caller state until `finished` is true.
    // Same reasoning as the open branch above: always `withTiming`, never a
    // bare assignment, even under reduceMotion.
    backdropOpacity.set(withTiming(0, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING }));
    translateY.set(
      withTiming(closeDistance, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING }, finished => {
        'worklet';
        if (finished) {
          runOnJS(setModalVisible)(false);
          runOnJS(onClosedRef.current)();
        }
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  // Plain transform, always present — NOT `identityOrNone`: that helper drops
  // the `transform` key entirely once the value is back at its identity (0),
  // which is a real anti-blur win when a key that's already applied just
  // stops changing. But the very first time the sheet reaches rest, the key
  // goes from *present* (a real offscreen offset) to *absent* in one step,
  // and Reanimated's web DOM patcher does not reliably clear a previously
  // applied CSS `transform` when a later style update simply omits the key —
  // the JS-computed style is correct (no transform) but the stale transform
  // stays painted, leaving the sheet permanently stuck offscreen. That was
  // this bug: "Shop the Post never opens" on web. A ever-present transform
  // key (even an identity one) always gets diffed and applied.
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  const closeFromGesture = () => {
    'worklet';
    backdropOpacity.set(withTiming(0, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING }));
    translateY.set(
      withTiming(closeDistance, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING }, finished => {
        'worklet';
        if (finished) {
          runOnJS(setModalVisible)(false);
          runOnJS(onClosedRef.current)();
        }
      }),
    );
  };

  // Snap points/content height are never touched mid-gesture: the pan only
  // ever writes to `translateY`, nothing about layout.
  const dragStartY = useSharedValue(0);
  // Measured via onSheetLayout below; falls back to closeDistance (a generous
  // over-estimate) until the first layout so an extremely early drag still
  // has a sane threshold rather than reading as `0 * 0.25 = 0` (always closes).
  const sheetHeight = useSharedValue(closeDistance);
  const onSheetLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0) sheetHeight.set(height);
  }, [sheetHeight]);

  const scrollGesture = Gesture.Native();
  const panGesture = detents
    ? Gesture.Pan()
      .simultaneousWithExternalGesture(scrollGesture)
      .onStart(() => {
        dragStartY.set(translateY.value);
      })
      .onUpdate(e => {
        // At the full detent with the list scrolled down, the list owns the
        // drag; the sheet only follows once the list is back at its top.
        if (dragStartY.value <= 0 && contentOffsetY.value > 0) return;
        const next = dragStartY.value + e.translationY;
        // Rubber-band past full instead of a hard stop.
        translateY.set(next < 0 ? next / 4 : next);
      })
      .onEnd(e => {
        if (dragStartY.value <= 0 && contentOffsetY.value > 0) return;
        // Project where a flick would land, then snap to the nearest of
        // full / half, or dismiss once past the half detent.
        const projected = translateY.value + e.velocityY * 0.12;
        const dismissLine = halfOffset + (detents.fullHeight - halfOffset) * 0.25;
        if (projected > dismissLine || (e.velocityY > 1200 && dragStartY.value >= halfOffset - 1)) {
          closeFromGesture();
          return;
        }
        const target = projected < halfOffset / 2 ? 0 : halfOffset;
        runOnJS(setDetent)(target === 0 ? 'full' : 'half');
        translateY.set(withTiming(target, { duration: SHEET_OPEN_MS, easing: SHEET_EASING }));
      })
    : Gesture.Pan()
    .onStart(() => {
      dragStartY.set(translateY.value);
    })
    .onUpdate(e => {
      const next = dragStartY.value + e.translationY;
      translateY.set(Math.max(0, next));
    })
    .onEnd(e => {
      // Past ~25% of the sheet's own height, or a fast flick, closes it —
      // otherwise it returns to open. Both paths are `withTiming`, never a
      // spring, so "returns" never overshoots past its resting position.
      const shouldClose = e.translationY > sheetHeight.value * 0.25 || e.velocityY > 800;
      if (shouldClose) {
        closeFromGesture();
      } else {
        translateY.set(withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING }));
      }
    });

  const onContentScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    contentOffsetY.set(Math.max(0, event.nativeEvent.contentOffset.y));
  }, [contentOffsetY]);

  return {
    modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout,
    detent,
    contentScrollEnabled: !detents || detent === 'full',
    onContentScroll,
    scrollGesture,
  };
}

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
  reduceMotion?: boolean | null;
  /** Half/full detents with a grabber, like Apple Maps / Instagram comments:
   *  opens at half, drag up for full, drag down from half to dismiss. */
  detents?: boolean;
}

export function BottomSheet({ visible, onClose, children, testID, reduceMotion, detents }: BottomSheetProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  // Modal portals straight to <body> on web, outside WebAppShell's centered
  // column, so an un-capped sheet would stretch edge-to-edge across a wide
  // desktop window instead of reading as a card. The backdrop still dims the
  // whole viewport (correct); only the sheet itself is capped and centered.
  const isWebShell = useIsWebShell();
  const fullHeight = sheetFullHeight(insets.top);
  const {
    modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout,
    contentScrollEnabled, onContentScroll, scrollGesture,
  } = useSheetTransition(visible, onClose, { reduceMotion, detents: detents ? { fullHeight } : undefined });
  const content = (
    <KeyboardAwareScrollViewCompat
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
      scrollEnabled={contentScrollEnabled}
      onScroll={detents ? onContentScroll : undefined}
      scrollEventThrottle={detents ? 16 : undefined}
    >
      {children}
    </KeyboardAwareScrollViewCompat>
  );

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose} testID={testID}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
          </Pressable>
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            {...a11yModalProps()}
            onLayout={onSheetLayout}
            style={[
              styles.sheet,
              isWebShell && styles.sheetWebShell,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                paddingBottom: Math.max(insets.bottom, SPACING.md),
              },
              detents && { height: fullHeight, maxHeight: fullHeight },
              sheetStyle,
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: palette.mutedForeground }]} />
            </View>
            {detents ? <GestureDetector gesture={scrollGesture}>{content}</GestureDetector> : content}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

/** Height of a detent sheet at its full detent: it stops just under the
 *  status bar / notch, leaving a sliver of the screen behind it visible like
 *  an iOS large-detent sheet. */
export function sheetFullHeight(topInset: number): number {
  return Math.round(Dimensions.get('window').height - Math.max(topInset, 20) - 10);
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    borderWidth: 1,
    maxHeight: '88%',
  },
  sheetWebShell: {
    width: '100%',
    maxWidth: WEB_SHELL_MAX_WIDTH,
    alignSelf: 'center',
  },
  handleWrap: { alignItems: 'center', paddingTop: SPACING.xs, paddingBottom: SPACING.xxs },
  handle: { width: 36, height: 4, borderRadius: RADII.pill, opacity: 0.3 },
});
