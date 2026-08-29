import React, { useEffect, useRef, useState } from 'react';
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
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BG, GRAD_HERO, GRAD_PRIMARY } from '@/lib/theme';

const AnimatedLayer = Animated.createAnimatedComponent(View);

type ParticleConfig = {
  x: number;
  y: number;
  size: number;
  duration: number;
  drift: number;
  opacity: number;
  phase: number;
  fadeIn: number;
  fadeOut: number;
};

function createParticleConfigs(): ParticleConfig[] {
  return Array.from({ length: 42 }, () => {
    const depth = Math.random();
    const size = depth < 0.5
      ? 0.8 + Math.random() * 1.1
      : depth < 0.84
        ? 1.5 + Math.random() * 1.5
        : 2.8 + Math.random() * 2;

    return {
      x: 0.02 + Math.random() * 0.96,
      y: 0.88 + Math.random() * 0.18,
      size,
      duration: 13000 + Math.random() * 25000,
      drift: -0.24 + Math.random() * 0.48,
      opacity: depth < 0.5
        ? 0.12 + Math.random() * 0.1
        : depth < 0.84
          ? 0.18 + Math.random() * 0.14
          : 0.26 + Math.random() * 0.16,
      phase: 0.02 + Math.random() * 0.94,
      fadeIn: 0.05 + Math.random() * 0.1,
      fadeOut: 0.08 + Math.random() * 0.16,
    };
  });
}

function FloatingParticle({
  x,
  y,
  size,
  duration,
  drift,
  opacity,
  phase,
  fadeIn,
  fadeOut,
  color,
}: ParticleConfig & { color: string }) {
  const { height, width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(phase)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    let mounted = true;
    const spawnNext = (from: number, cycleDuration: number) => {
      progress.setValue(from);
      animation.current = Animated.timing(progress, {
        toValue: 1,
        duration: cycleDuration,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      animation.current.start(({ finished }) => {
        if (!mounted || !finished) return;
        // Recycle at the bottom immediately so the ambient field never drains.
        spawnNext(0, duration * (0.84 + Math.random() * 0.32));
      });
    };

    spawnNext(phase, Math.max(3500, duration * (1 - phase)));
    return () => {
      mounted = false;
      animation.current?.stop();
    };
  }, [duration, phase, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          width: size,
          height: size,
          left: width * x,
          top: height * y,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: progress.interpolate({
            inputRange: [0, fadeIn, 1 - fadeOut, 1],
            outputRange: [0, opacity, opacity, 0],
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, width * drift],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [height * 0.12, -height * 1.08],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0.8, 1, 0.9],
              }),
            },
          ],
        },
      ]}
    />
  );
}

function LightTrail({
  top,
  duration,
  delay,
  reverse = false,
}: {
  top: number;
  duration: number;
  delay: number;
  reverse?: boolean;
}) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, duration, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.trail,
        {
          top,
          opacity: progress.interpolate({
            inputRange: [0, 0.12, 0.72, 1],
            outputRange: [0, 0.22, 0.16, 0],
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: reverse
                  ? [width * 1.25, -width * 0.8]
                  : [-width * 0.8, width * 1.25],
              }),
            },
            { rotate: reverse ? '11deg' : '-13deg' },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={[
          'rgba(243,245,247,0)',
          'rgba(243,245,247,0.08)',
          'rgba(243,245,247,0.62)',
          'rgba(243,245,247,0)',
        ]}
        locations={[0, 0.35, 0.72, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.trailGradient}
      />
    </Animated.View>
  );
}

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
  const { theme } = useAppTheme();
  const [particles] = useState(createParticleConfigs);
  const drift = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const depth = useRef(new Animated.Value(0)).current;

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
    const depthLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(depth, {
          toValue: 1,
          duration: 41000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(depth, {
          toValue: 0,
          duration: 41000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    driftLoop.start();
    shimmerLoop.start();
    depthLoop.start();
    return () => {
      driftLoop.stop();
      shimmerLoop.stop();
      depthLoop.stop();
    };
  }, [depth, drift, shimmer]);

  const layerWidth = Math.max(width * 2.1, 840);
  const layerHeight = Math.max(height * 2.05, 1430);
  const layerPosition = {
    position: 'absolute' as const,
    width: layerWidth,
    height: layerHeight,
    left: (width - layerWidth) / 2,
    top: (height - layerHeight) / 2,
  };

  const primaryMotion = {
    opacity: 0.3,
    transform: [
      {
        translateX: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [-width * 0.24, width * 0.24],
        }),
      },
      {
        translateY: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [height * 0.16, -height * 0.16],
        }),
      },
      {
        rotate: drift.interpolate({
          inputRange: [0, 1],
          outputRange: ['-11deg', '11deg'],
        }),
      },
    ],
  };
  const heroMotion = {
    opacity: 0.24,
    transform: [
      {
        translateX: shimmer.interpolate({
          inputRange: [0, 1],
          outputRange: [width * 0.28, -width * 0.28],
        }),
      },
      {
        translateY: shimmer.interpolate({
          inputRange: [0, 1],
          outputRange: [-height * 0.13, height * 0.13],
        }),
      },
      {
        rotate: shimmer.interpolate({
          inputRange: [0, 1],
          outputRange: ['13deg', '-13deg'],
        }),
      },
    ],
  };
  const depthMotion = {
    opacity: 0.16,
    transform: [
      {
        translateX: depth.interpolate({
          inputRange: [0, 1],
          outputRange: [-width * 0.16, width * 0.16],
        }),
      },
      {
        translateY: depth.interpolate({
          inputRange: [0, 1],
          outputRange: [-height * 0.24, height * 0.24],
        }),
      },
      {
        rotate: depth.interpolate({
          inputRange: [0, 1],
          outputRange: ['18deg', '-18deg'],
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
      <AnimatedLayer style={[layerPosition, depthMotion]}>
        <LinearGradient
          colors={GRAD_PRIMARY}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </AnimatedLayer>
      <AnimatedLayer
        style={[
          layerPosition,
          {
            opacity: shimmer.interpolate({
              inputRange: [0, 1],
              outputRange: [0.08, 0.2],
            }),
            transform: [
              { skewX: '-8deg' },
              {
                translateX: shimmer.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-width * 0.18, width * 0.18],
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
      <LinearGradient
        colors={[
          'rgba(7,7,15,0.62)',
          'rgba(7,7,15,0.34)',
          'rgba(7,7,15,0.68)',
        ]}
        locations={[0, 0.48, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.moodOverlay}
      />
      <View pointerEvents="none" style={styles.grid}>
        {Array.from({ length: Math.ceil(width / 64) + 1 }, (_, index) => (
          <View
            key={`grid-v-${index}`}
            style={[styles.gridVertical, { left: index * 64 }]}
          />
        ))}
        {Array.from({ length: Math.ceil(height / 64) + 1 }, (_, index) => (
          <View
            key={`grid-h-${index}`}
            style={[styles.gridHorizontal, { top: index * 64 }]}
          />
        ))}
      </View>
      <LightTrail top={height * 0.24} duration={18000} delay={7000} />
      <LightTrail top={height * 0.7} duration={24000} delay={13000} reverse />
      {particles.map((particle, index) => (
        <FloatingParticle
          key={`${particle.x}-${particle.y}`}
          {...particle}
          color={index % 3 === 0 ? GRAD_HERO[2] : theme.accentLight}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    overflow: 'hidden',
  },
  moodOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.3,
    transform: [{ rotate: '-4deg' }, { scale: 1.15 }],
  },
  gridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(243,245,247,0.09)',
  },
  gridHorizontal: {
    position: 'absolute',
    right: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(243,245,247,0.07)',
  },
  trail: {
    position: 'absolute',
    left: 0,
    width: 260,
    height: 2,
  },
  trailGradient: {
    width: '100%',
    height: '100%',
  },
  particle: {
    position: 'absolute',
    shadowColor: '#F3F5F7',
    shadowOpacity: 0.65,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
});