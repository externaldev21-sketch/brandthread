import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, GRAD_HERO, GRAD_PRIMARY } from '@/lib/theme';

const AnimatedLayer = Animated.createAnimatedComponent(View);

/**
 * Slow ambient motion for branded entry and setup screens.
 *
 * The oversized layers intentionally extend beyond the viewport so their
 * transforms never reveal an unpainted edge while they drift.
 */
export default function AnimatedGradientBackground({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  const { width, height } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 26000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 26000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 32000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 32000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    driftLoop.start();
    shimmerLoop.start();
    return () => {
      driftLoop.stop();
      shimmerLoop.stop();
    };
  }, [drift, shimmer]);

  const layerWidth = Math.max(width * 1.7, 680);
  const layerHeight = Math.max(height * 1.7, 1180);
  const layerPosition = {
    position: 'absolute' as const,
    width: layerWidth,
    height: layerHeight,
    left: (width - layerWidth) / 2,
    top: (height - layerHeight) / 2,
  };

  const primaryMotion = {
    opacity: 0.22,
    transform: [
      {
        translateX: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [-width * 0.12, width * 0.12],
        }),
      },
      {
        translateY: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [height * 0.08, -height * 0.08],
        }),
      },
      {
        rotate: drift.interpolate({
          inputRange: [0, 1],
          outputRange: ['-5deg', '5deg'],
        }),
      },
    ],
  };
  const heroMotion = {
    opacity: 0.18,
    transform: [
      {
        translateX: shimmer.interpolate({
          inputRange: [0, 1],
          outputRange: [width * 0.14, -width * 0.14],
        }),
      },
      {
        translateY: shimmer.interpolate({
          inputRange: [0, 1],
          outputRange: [-height * 0.06, height * 0.06],
        }),
      },
      {
        rotate: shimmer.interpolate({
          inputRange: [0, 1],
          outputRange: ['7deg', '-7deg'],
        }),
      },
    ],
  };

  return (
    <View pointerEvents="none" style={[styles.root, style]}>
      <AnimatedLayer style={[layerPosition, primaryMotion]}>
        <LinearGradient
          colors={GRAD_HERO}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </AnimatedLayer>
      <AnimatedLayer style={[layerPosition, heroMotion]}>
        <LinearGradient
          colors={GRAD_PRIMARY}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </AnimatedLayer>
      <AnimatedLayer
        style={[
          layerPosition,
          {
            opacity: shimmer.interpolate({
              inputRange: [0, 1],
              outputRange: [0.05, 0.13],
            }),
            transform: [
              { skewX: '-8deg' },
              {
                translateX: shimmer.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-width * 0.08, width * 0.08],
                }),
              },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={GRAD_HERO}
          start={{ x: 0, y: 0.35 }}
          end={{ x: 1, y: 0.65 }}
          style={StyleSheet.absoluteFill}
        />
      </AnimatedLayer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    overflow: 'hidden',
  },
});