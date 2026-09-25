/**
 * Brandthread Design System — Skeleton (Phase 1)
 *
 * Composable shimmer blocks for building loading states that roughly match
 * real layouts. `components/layout/Skeleton.tsx` already provides several
 * screen-shaped presets (CardSkeleton, RowSkeleton, GridSkeleton, etc) built
 * the same way — that file is the canonical preset library; this exports the
 * base `SkeletonBlock` under the `components/ui` namespace for discoverability
 * and adds a text-line convenience on top of it.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { RADII } from '@/constants/radii';

export function SkeletonBlock({ width, height, radius = RADII.chip, style }: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.cardElevated, opacity: pulse }, style]}
    />
  );
}

export function SkeletonLine({ width = '70%', height = 12, style }: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <SkeletonBlock width={width} height={height} radius={4} style={style} />;
}
