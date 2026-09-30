/**
 * Animated white hand/finger glyph performing a real gesture (tap, swipe,
 * hold, drag, pinch) — the visual language for the `gesture` variant and the
 * rows inside the `fullscreen` variant. Built on the same Animated-API loop
 * technique as components/FeedGestureGuide.tsx for a consistent feel across
 * the app's first-run surfaces.
 *
 * Reskinned from Mobbin references cited in the PR (Quizlet swipe-to-preview
 * for the single small gesture hint; Telegram "Watching Stories" / Polarsteps
 * for the full-screen row treatment) into this app's strict monochrome
 * (white glyph on dark/blurred ground) with Inter type.
 *
 * Renders a static end-state (no looping animation) when `reduceMotion` is
 * true — same information, no motion.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GestureKind } from './types';

const ICON_BY_GESTURE: Record<GestureKind, keyof typeof MaterialCommunityIcons.glyphMap> = {
  tap: 'gesture-tap',
  hold: 'gesture-tap-hold',
  'swipe-left': 'gesture-swipe-left',
  'swipe-right': 'gesture-swipe-right',
  'swipe-up': 'gesture-swipe-up',
  drag: 'gesture-swipe-horizontal',
  pinch: 'gesture-pinch',
};

export function GestureGlyph({
  gesture,
  size = 32,
  color = '#FFFFFF',
  reduceMotion = false,
}: {
  gesture: GestureKind;
  size?: number;
  color?: string;
  reduceMotion?: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduceMotion]);

  const icon = ICON_BY_GESTURE[gesture];

  if (reduceMotion) {
    return (
      <View style={styles.static}>
        <MaterialCommunityIcons name={icon} size={size} color={color} />
      </View>
    );
  }

  const translate = (() => {
    switch (gesture) {
      case 'swipe-left': return { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [8, -8] }) }] };
      case 'swipe-right': return { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) }] };
      case 'swipe-up': return { transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [6, -6] }) }] };
      case 'drag': return { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-10, 10] }) }] };
      case 'pinch':
      case 'tap':
      case 'hold':
      default:
        return { transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: gesture === 'pinch' ? [1.1, 0.85] : [1, 0.82] }) }] };
    }
  })();

  const opacity = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.45, 1, 0.45] });

  return (
    <Animated.View style={[styles.animated, translate, { opacity }]}>
      <MaterialCommunityIcons name={icon} size={size} color={color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  animated: { alignItems: 'center', justifyContent: 'center' },
  static: { alignItems: 'center', justifyContent: 'center' },
});
