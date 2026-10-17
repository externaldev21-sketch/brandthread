import React, { useEffect } from 'react';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { RailGlyph } from './RailGlyph';

/** One UI-thread heart at the second tap, never a second like toggle. */
export function TapHeartBurst({ point, reduceMotion = false }: {
  point: { x: number; y: number } | null; reduceMotion?: boolean;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.6);
  const rise = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(opacity); cancelAnimation(scale); cancelAnimation(rise);
    if (!point) { opacity.value = 0; return; }
    opacity.value = 1; scale.value = reduceMotion ? 1 : 0.6; rise.value = 0;
    if (!reduceMotion) {
      scale.value = withSequence(withSpring(1.08, { damping: 17, stiffness: 290 }), withTiming(1, { duration: 110 }));
      rise.value = withTiming(-64, { duration: 680 });
    }
    opacity.value = withDelay(330, withTiming(0, { duration: reduceMotion ? 100 : 350 }));
    return () => { cancelAnimation(opacity); cancelAnimation(scale); cancelAnimation(rise); };
  }, [point, reduceMotion, opacity, scale, rise]);
  const animation = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: rise.value }, { scale: scale.value }] }));
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ position: 'absolute', width: 96, height: 96, left: point ? point.x - 48 : -9999, top: point ? point.y - 48 : -9999 }, animation]}>
    <RailGlyph name="heart" size={96} color="#E5484D" shadow />
  </Animated.View>;
}
