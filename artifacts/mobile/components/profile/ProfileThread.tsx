/**
 * ProfileThread — the onboarding thread motif, carried onto profiles.
 *
 * The same vector thread (geometry + ThreadLine primitive) that sews the
 * onboarding flow together draws once across the profile hero, so a profile
 * reads as the next stitch of the same garment. Decorative only: no haptics,
 * pointer-events none, and it renders fully drawn (no animation) under
 * Reduce Motion.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion, useSharedValue, withDelay, withTiming, cancelAnimation } from 'react-native-reanimated';
import { ThreadLine } from '@/components/onboarding/ThreadLine';
import { welcomeThread } from '@/components/onboarding/threadGeometry';
import { MOTION } from '@/components/onboarding/onboardingTokens';

export function ProfileThread({
  height,
  color,
  opacity = 0.55,
  delay = 180,
  style,
}: {
  height: number;
  color: string;
  opacity?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const geometry = useMemo(() => welcomeThread(width, height), [width, height]);

  useEffect(() => {
    if (!width) return;
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delay, withTiming(1, { duration: MOTION.welcomeDrawMs, easing: MOTION.draw }));
    return () => cancelAnimation(progress);
  }, [width, reduceMotion, delay, progress]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  return (
    <View
      style={[{ height, opacity }, style]}
      onLayout={onLayout}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 ? (
        <ThreadLine geometry={geometry} width={width} height={height} progress={progress} color={color} needle={!reduceMotion} />
      ) : null}
    </View>
  );
}
