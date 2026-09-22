import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  createBackgroundPalette,
  hexToRgba,
  type BackgroundPalette,
} from '@/lib/backgroundPalette';

type SilkRibbonConfig = {
  center: number;
  thickness: number;
  amplitude: number;
  slope: number;
  duration: number;
  phase: number;
  opacity: number;
};

const SILK_RIBBONS: readonly SilkRibbonConfig[] = [
  {
    center: 0.04,
    thickness: 0.4,
    amplitude: 0.12,
    slope: 0.24,
    duration: 52000,
    phase: 0.2,
    opacity: 0.68,
  },
  {
    center: 0.32,
    thickness: 0.3,
    amplitude: -0.11,
    slope: -0.2,
    duration: 68000,
    phase: 2.2,
    opacity: 0.54,
  },
  {
    center: 0.64,
    thickness: 0.37,
    amplitude: 0.13,
    slope: 0.18,
    duration: 61000,
    phase: 4.5,
    opacity: 0.61,
  },
  {
    center: 0.92,
    thickness: 0.34,
    amplitude: -0.09,
    slope: -0.22,
    duration: 74000,
    phase: 5.7,
    opacity: 0.5,
  },
];

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
  return Array.from({ length: 50 }, () => {
    const depth = Math.random();
    return {
      x: 0.02 + Math.random() * 0.96,
      y: 0.8 + Math.random() * 0.26,
      size: depth < 0.54
        ? 0.8 + Math.random() * 1.2
        : depth < 0.86
          ? 1.5 + Math.random() * 1.7
          : 3 + Math.random() * 2,
      duration: 14000 + Math.random() * 28000,
      drift: -0.24 + Math.random() * 0.48,
      opacity: depth < 0.54
        ? 0.1 + Math.random() * 0.12
        : depth < 0.86
          ? 0.17 + Math.random() * 0.14
          : 0.26 + Math.random() * 0.16,
      phase: 0.02 + Math.random() * 0.94,
      fadeIn: 0.05 + Math.random() * 0.1,
      fadeOut: 0.08 + Math.random() * 0.16,
    };
  });
}

function FloatingParticle({
  particle,
  width,
  height,
  color,
}: {
  particle: ParticleConfig;
  width: number;
  height: number;
  color: string;
}) {
  const { x, y, size, duration, drift, opacity, phase, fadeIn, fadeOut } = particle;
  const progress = useRef(new Animated.Value(phase)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    const spawnNext = (from: number, cycleDuration: number) => {
      if (!active.current) return;
      progress.setValue(from);
      const nextAnimation = Animated.timing(progress, {
        toValue: 1,
        duration: cycleDuration,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      animation.current = nextAnimation;
      nextAnimation.start(({ finished }) => {
        if (!active.current || !finished || animation.current !== nextAnimation) return;
        spawnNext(0, duration * (0.84 + Math.random() * 0.32));
      });
    };

    spawnNext(phase, Math.max(3500, duration * (1 - phase)));
    return () => {
      active.current = false;
      animation.current?.stop();
      animation.current = null;
    };
  }, [duration, phase]);

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
                outputRange: [height * 0.12, -height * 1.1],
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

function ParticleField({
  width,
  height,
  palette,
}: {
  width: number;
  height: number;
  palette: BackgroundPalette;
}) {
  const particles = useRef<ParticleConfig[] | null>(null);
  if (!particles.current) {
    particles.current = createParticleConfigs();
  }

  return (
    <View pointerEvents="none" style={styles.particleField}>
      {particles.current.map((particle, index) => (
        <FloatingParticle
          key={`particle-${index}`}
          particle={particle}
          width={width}
          height={height}
          color={index % 4 === 0 ? palette.particlePrimary : palette.particleSecondary}
        />
      ))}
    </View>
  );
}

function LightTrail({
  top,
  duration,
  delay,
  reverse = false,
  palette,
}: {
  top: number;
  duration: number;
  delay: number;
  reverse?: boolean;
  palette: BackgroundPalette;
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
          hexToRgba(palette.ribbonLight, 0),
          palette.trailSoft,
          palette.trailStrong,
          hexToRgba(palette.ribbonLight, 0),
        ]}
        locations={[0, 0.35, 0.72, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.trailGradient}
      />
    </Animated.View>
  );
}

function ribbonGeometry(
  width: number,
  height: number,
  ribbon: SilkRibbonConfig,
  elapsed: number,
) {
  const motion = (elapsed / ribbon.duration) * Math.PI * 2 + ribbon.phase;
  const wave = Math.sin(motion);
  const counterWave = Math.sin(motion * 0.67 + 1.4);
  const center = height * ribbon.center + height * 0.035 * wave;
  const amplitude = height * ribbon.amplitude;
  const thickness = height * ribbon.thickness;
  const left = -width * 0.18;
  const right = width * 1.18;
  const at = (x: number) =>
    center + height * ribbon.slope * (x - 0.5);
  const top0 = at(-0.18) - thickness / 2 + amplitude * Math.sin(motion + 0.2);
  const top1 = at(0.04) - thickness / 2 + amplitude * Math.sin(motion + 1.3);
  const top2 = at(0.24) - thickness / 2 + amplitude * Math.sin(motion + 2.3);
  const top3 = at(0.49) - thickness / 2 + amplitude * counterWave;
  const top4 = at(0.92) - thickness / 2 + amplitude * Math.sin(motion + 3.1);
  const top5 = at(1.18) - thickness / 2 + amplitude * Math.sin(motion + 4.2);
  const bottom0 = at(-0.18) + thickness / 2 + amplitude * Math.sin(motion + 2.7);
  const bottom1 = at(0.42) + thickness / 2 + amplitude * Math.sin(motion + 3.5);
  const bottom2 = at(0.67) + thickness / 2 + amplitude * Math.sin(motion + 4.4);
  const bottom3 = at(0.92) + thickness / 2 + amplitude * Math.sin(motion + 5.2);
  const bottom4 = at(1.18) + thickness / 2 + amplitude * Math.sin(motion + 5.8);

  const body = [
    `M ${left} ${top0}`,
    `C ${width * 0.04} ${top1} ${width * 0.24} ${top2} ${width * 0.49} ${top3}`,
    `S ${width * 0.92} ${top4} ${right} ${top5}`,
    `L ${right} ${bottom4}`,
    `C ${width * 0.92} ${bottom3} ${width * 0.67} ${bottom2} ${width * 0.42} ${bottom1}`,
    `S ${width * 0.04} ${bottom0} ${left} ${bottom0}`,
    'Z',
  ].join(' ');

  const sheen = [
    `M ${left} ${at(-0.18) + amplitude * 0.18}`,
    `C ${width * 0.12} ${at(0.12) + amplitude * Math.sin(motion + 0.9)}`,
    `${width * 0.3} ${at(0.3) + amplitude * Math.sin(motion + 2.1)}`,
    `${width * 0.52} ${at(0.52) + amplitude * Math.sin(motion + 1.4)}`,
    `S ${width * 0.94} ${at(0.94) + amplitude * Math.sin(motion + 3.7)} ${right} ${at(1.18) + amplitude * Math.sin(motion + 4.8)}`,
  ].join(' ');

  return { body, sheen };
}

function SilkRibbon({
  ribbon,
  index,
  width,
  height,
  palette,
}: {
  ribbon: SilkRibbonConfig;
  index: number;
  width: number;
  height: number;
  palette: BackgroundPalette;
}) {
  const [elapsed, setElapsed] = useState(0);
  const frame = useRef<number | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const startTime = Date.now();
    let lastPaint = startTime;
    const tick = () => {
      if (!mounted.current) return;
      const now = Date.now();
      if (now - lastPaint >= 48) {
        lastPaint = now;
        setElapsed(now - startTime);
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      mounted.current = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  const { body, sheen } = ribbonGeometry(width, height, ribbon, elapsed);
  const pulse =
    0.88 + 0.12 * Math.sin((elapsed / ribbon.duration) * Math.PI * 2 + ribbon.phase);

  return (
    <>
      <Path
        d={body}
        fill={`url(#silk-${index})`}
        opacity={ribbon.opacity * pulse}
      />
      <Path
        d={body}
        fill="none"
        stroke={palette.ribbonMid}
        strokeWidth={height * 0.035}
        strokeLinecap="round"
        opacity={0.035 * pulse}
      />
      <Path
        d={sheen}
        fill="none"
        stroke="url(#silk-sheen)"
        strokeWidth={height * 0.035}
        strokeLinecap="round"
        opacity={0.16 * pulse}
      />
      <Path
        d={sheen}
        fill="none"
        stroke={palette.ribbonLight}
        strokeWidth={height * 0.0018}
        strokeLinecap="round"
        opacity={0.16 * pulse}
      />
    </>
  );
}

function SilkRibbonField({
  width,
  height,
  palette,
}: {
  width: number;
  height: number;
  palette: BackgroundPalette;
}) {
  return (
    <View pointerEvents="none" style={styles.silkField}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          {SILK_RIBBONS.map((_, index) => (
            <SvgGradient
              key={`silk-gradient-${index}`}
              id={`silk-${index}`}
              x1="0%"
              y1={index % 2 === 0 ? '0%' : '100%'}
              x2="100%"
              y2={index % 2 === 0 ? '100%' : '0%'}
            >
              <Stop offset="0%" stopColor={palette.ribbonDark} stopOpacity={0.94} />
              <Stop offset="32%" stopColor={palette.ribbonMid} stopOpacity={0.18} />
              <Stop offset="49%" stopColor={palette.ribbonLight} stopOpacity={0.055} />
              <Stop offset="64%" stopColor={palette.ribbonMid} stopOpacity={0.14} />
              <Stop offset="100%" stopColor={palette.ribbonDark} stopOpacity={0.95} />
            </SvgGradient>
          ))}
          <SvgGradient id="silk-sheen" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={palette.ribbonMid} stopOpacity={0} />
            <Stop offset="35%" stopColor={palette.sheen} stopOpacity={0.1} />
            <Stop offset="58%" stopColor={palette.sheen} stopOpacity={0.3} />
            <Stop offset="78%" stopColor={palette.ribbonMid} stopOpacity={0.08} />
            <Stop offset="100%" stopColor={palette.ribbonMid} stopOpacity={0} />
          </SvgGradient>
        </Defs>
        {SILK_RIBBONS.map((ribbon, index) => (
          <SilkRibbon
            key={`silk-ribbon-${index}`}
            ribbon={ribbon}
            index={index}
            width={width}
            height={height}
            palette={palette}
          />
        ))}
      </Svg>
    </View>
  );
}

export default function AnimatedGradientBackground({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const gradient = theme.heroGradient;
  const gradientLocations = gradient.map(
    (_, index) => index / Math.max(1, gradient.length - 1),
  ) as [number, number, ...number[]];
  return (
    <View pointerEvents="none" style={[styles.root, { backgroundColor: theme.background }, style]}>
      <LinearGradient
        colors={gradient}
        locations={gradientLocations}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.baseGradient}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  baseGradient: {
    ...StyleSheet.absoluteFill,
  },
  silkField: {
    ...StyleSheet.absoluteFill,
  },
  particleField: {
    ...StyleSheet.absoluteFill,
  },
  particle: {
    position: 'absolute',
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
});