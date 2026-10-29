/**
 * PressScale — the shared press squish (PRESS_SCALE 0.97 on the shared
 * critically-damped PRESS_SPRING, via pressScaleAnim; Reduce Motion: none)
 * as a light Pressable, for small controls that live in leaf modules
 * (analytics pills) where pulling in BrandthreadUI's PressableScale would
 * drag its whole module graph along. Pack 2, item 22.
 */
import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

export function PressScale({ style, children, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => { pressScaleAnim(scale, PRESS_SCALE).start(); onPressIn?.(e); }}
      onPressOut={(e) => { pressScaleAnim(scale, 1).start(); onPressOut?.(e); }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
