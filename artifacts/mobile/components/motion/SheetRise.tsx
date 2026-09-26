import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, useWindowDimensions, type ViewProps } from 'react-native';
import { SHEET_EASING_BEZIER, SHEET_OPEN_MS } from '@/constants/motion';
import { useSettled } from '@/lib/animationUtils';

/**
 * Bottom-sheet entrance for `<Modal transparent animationType="fade">`.
 *
 * A transparent Modal with `animationType="slide"` slides its dim backdrop up
 * together with the sheet, which looks cheap. Instead the Modal fades (so the
 * backdrop dims in place) and the sheet inside it slides up on the app's
 * shared `SHEET_TIMING` curve — a plain timing, never a spring, so it never
 * overshoots/oscillates before settling. (PR #132: this used to be a spring,
 * which bounced visibly on the Shop the Post sheet; every sheet now shares
 * this one non-bouncy timing curve.)
 *
 *   <Modal visible transparent animationType="fade" onRequestClose={close}>
 *     <Pressable style={styles.backdrop} onPress={close} />
 *     <SheetRise style={styles.sheet}>…</SheetRise>
 *   </Modal>
 *
 * It is a drop-in replacement for the sheet's outer <View>: same props, same
 * style. Respects Reduce Motion (the Modal's fade still plays).
 */
export function SheetRise({ style, children, ...rest }: ViewProps & { children?: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const distance = Math.min(460, Math.max(240, height * 0.5));
  const progress = useRef(new Animated.Value(0)).current;
  // Once the rise has settled at rest, this stops rendering an Animated.View
  // with an identity `transform: [{ translateY: 0 }]` — which react-native-web
  // would otherwise leave in place forever as a `matrix(1,0,0,1,0,0)`
  // compositing layer, softening the sheet's text if that layer's box lands
  // on a fractional device pixel. See lib/animationUtils.ts.
  const settled = useSettled();

  useEffect(() => {
    let cancelled = false;
    const run = (reduceMotion: boolean) => {
      if (cancelled) return;
      if (reduceMotion) {
        progress.setValue(1);
        settled.settleImmediately();
        return;
      }
      settled.run(
        Animated.timing(progress, {
          toValue: 1,
          duration: SHEET_OPEN_MS,
          easing: Easing.bezier(...SHEET_EASING_BEZIER),
          useNativeDriver: Platform.OS !== 'web',
        }),
      );
    };
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(run)
      .catch(() => run(false)) ?? run(false);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });

  return (
    <Animated.View {...rest} style={[style, !settled.value && { transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
