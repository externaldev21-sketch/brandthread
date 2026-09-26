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
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { identityOrNone } from '@/lib/animationUtils';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';
import {
  FADE_MS, SHEET_CLOSE_EASING, SHEET_CLOSE_MS, SHEET_OFFSCREEN_Y, SHEET_SPRING,
} from '@/constants/motion';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';

export interface SheetTransition {
  /** Whether the sheet's Modal should currently be mounted/shown. Stays true
   *  through the whole close animation and only flips false once it's done —
   *  drive `<Modal visible={modalVisible} ...>` (or an equivalent) from it. */
  modalVisible: boolean;
  /** Animated style for the sheet's translateY — apply to the sheet's outer
   *  `Animated.View`. */
  sheetStyle: AnimatedStyle<{ transform: { translateY: number }[] }>;
  /** Animated style for the backdrop's opacity — apply to the backdrop's
   *  `Animated.View`, on the exact same timeline as `sheetStyle`. */
  backdropStyle: AnimatedStyle<{ opacity: number }>;
  /** Pan gesture for swipe-to-close: attach via `<GestureDetector gesture={panGesture}>`
   *  around the sheet's outer `Animated.View` (or a drag-handle region of it). */
  panGesture: ReturnType<typeof Gesture.Pan>;
}

/**
 * Drives a sheet's open/close transform + backdrop opacity, and its
 * swipe-to-close gesture, all on the UI thread. `onClosed` fires exactly
 * once the close animation has finished — never before, and never if the
 * animation is interrupted by another `visible` flip.
 */
export function useSheetTransition(
  visible: boolean,
  onClosed: () => void,
  opts?: { closeDistance?: number; reduceMotion?: boolean | null },
): SheetTransition {
  const closeDistance = opts?.closeDistance ?? SHEET_OFFSCREEN_Y;
  const reduceMotion = !!opts?.reduceMotion;
  const translateY = useSharedValue(closeDistance);
  const backdropOpacity = useSharedValue(0);
  const [modalVisible, setModalVisible] = useState(visible);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      if (reduceMotion) {
        translateY.set(0);
        backdropOpacity.set(1);
        return;
      }
      backdropOpacity.set(withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.cubic) }));
      translateY.set(withSpring(0, SHEET_SPRING));
      return;
    }
    // Closing: keep the Modal mounted until the transform finishes — this is
    // the single close timeline (sheet + backdrop share duration/easing), and
    // nothing unmounts or clears caller state until `finished` is true.
    if (reduceMotion) {
      translateY.set(closeDistance);
      backdropOpacity.set(0);
      setModalVisible(false);
      onClosedRef.current();
      return;
    }
    backdropOpacity.set(withTiming(0, { duration: SHEET_CLOSE_MS, easing: SHEET_CLOSE_EASING }));
    translateY.set(
      withTiming(closeDistance, { duration: SHEET_CLOSE_MS, easing: SHEET_CLOSE_EASING }, finished => {
        'worklet';
        if (finished) {
          runOnJS(setModalVisible)(false);
          runOnJS(onClosedRef.current)();
        }
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  // `identityOrNone` drops the `transform` key entirely once the sheet is
  // fully open (translateY back at 0) instead of leaving an identity
  // `[{ translateY: 0 }]` — on web that would otherwise permanently force
  // this View onto its own compositing layer, softening the sheet's text if
  // that layer doesn't land on a whole device pixel. See lib/animationUtils.ts.
  const sheetStyle = useAnimatedStyle(() => ({ transform: identityOrNone([{ translateY: translateY.value }]) }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  // Snap points/content height are never touched mid-gesture: the pan only
  // ever writes to `translateY`, nothing about layout.
  const dragStartY = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      dragStartY.set(translateY.value);
    })
    .onUpdate(e => {
      const next = dragStartY.value + e.translationY;
      translateY.set(Math.max(0, next));
    })
    .onEnd(e => {
      const shouldClose = e.translationY > 80 || e.velocityY > 800;
      if (shouldClose) {
        backdropOpacity.set(withTiming(0, { duration: SHEET_CLOSE_MS, easing: SHEET_CLOSE_EASING }));
        translateY.set(
          withTiming(closeDistance, { duration: SHEET_CLOSE_MS, easing: SHEET_CLOSE_EASING }, finished => {
            'worklet';
            if (finished) {
              runOnJS(setModalVisible)(false);
              runOnJS(onClosedRef.current)();
            }
          }),
        );
      } else {
        translateY.set(withSpring(0, SHEET_SPRING));
      }
    });

  return { modalVisible, sheetStyle, backdropStyle, panGesture };
}

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
  reduceMotion?: boolean | null;
}

export function BottomSheet({ visible, onClose, children, testID, reduceMotion }: BottomSheetProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  // Modal portals straight to <body> on web, outside WebAppShell's centered
  // column, so an un-capped sheet would stretch edge-to-edge across a wide
  // desktop window instead of reading as a card. The backdrop still dims the
  // whole viewport (correct); only the sheet itself is capped and centered.
  const isWebShell = useIsWebShell();
  const { modalVisible, sheetStyle, backdropStyle, panGesture } = useSheetTransition(visible, onClose, {
    reduceMotion,
  });

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
            style={[
              styles.sheet,
              isWebShell && styles.sheetWebShell,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                paddingBottom: Math.max(insets.bottom, SPACING.md),
              },
              sheetStyle,
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: palette.mutedForeground }]} />
            </View>
            <KeyboardAwareScrollViewCompat keyboardShouldPersistTaps="handled" bottomOffset={24}>
              {children}
            </KeyboardAwareScrollViewCompat>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
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
