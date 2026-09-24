import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, useWindowDimensions, type ViewProps } from 'react-native';

/**
 * Bottom-sheet entrance for `<Modal transparent animationType="fade">`.
 *
 * A transparent Modal with `animationType="slide"` slides its dim backdrop up
 * together with the sheet, which looks cheap. Instead the Modal fades (so the
 * backdrop dims in place) and the sheet inside it springs up from below and
 * settles with a small, soft rebound.
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

  useEffect(() => {
    let cancelled = false;
    const run = (reduceMotion: boolean) => {
      if (cancelled) return;
      if (reduceMotion) {
        progress.setValue(1);
        return;
      }
      Animated.spring(progress, {
        toValue: 1,
        speed: 13,
        bounciness: 5,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    };
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(run)
      .catch(() => run(false)) ?? run(false);
    return () => { cancelled = true; };
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });

  return (
    <Animated.View {...rest} style={[style, { transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
