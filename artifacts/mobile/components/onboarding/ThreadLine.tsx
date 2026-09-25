/**
 * ThreadLine — Brandthread's signature onboarding motif.
 *
 * A single thin white thread runs through the whole flow. It is a real
 * vector stroke (react-native-svg) whose draw-on is a strokeDashoffset
 * animation driven by Reanimated on the UI thread, so it stays pin-sharp at
 * any scale and holds 60fps while JS is busy (auth calls, draft saves).
 *
 *  - `ThreadLine`       the primitive: one geometry + one progress value.
 *  - `ThreadDraw`       self-playing draw-on (Welcome hero, splash).
 *  - `ThreadProgress`   the stepper's progress indicator: the thread is
 *                       sewn node-to-node as the user advances.
 *  - `ThreadWeave`      the step transition: a length of thread pulls
 *                       across behind the headline, dragging the next
 *                       screen in with it.
 *  - `ThreadLogoStitch` the finale: the thread sews the "B" mark, then the
 *                       real logo resolves over the stitching.
 *
 * Every variant honours Reduce Motion: the thread renders in its final
 * state (or not at all, for the purely decorative weave) with no haptics.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { MOTION, THREAD, useOnboardingMotion } from './onboardingTokens';
import {
  LOGO_STITCH_LEAD_IN,
  logoStitchThread,
  progressThread,
  weaveThread,
  welcomeThread,
  type ThreadGeometry,
} from './threadGeometry';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Primitive ────────────────────────────────────────────────────────────────

export type ThreadLineProps = {
  geometry: ThreadGeometry;
  width: number;
  height: number;
  /** 0 → 1. In `draw` mode the head position; in `segment` mode the travel of a fixed length of thread. */
  progress: SharedValue<number>;
  mode?: 'draw' | 'segment';
  /** Visible length (fraction of the path) in `segment` mode. */
  segment?: number;
  color: string;
  strokeWidth?: number;
  glow?: boolean;
  /** Glowing needle tip riding the leading end of the thread. */
  needle?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export function ThreadLine({
  geometry,
  width,
  height,
  progress,
  mode = 'draw',
  segment = 0.45,
  color,
  strokeWidth = THREAD.stroke,
  glow = true,
  needle = true,
  style,
  children,
}: ThreadLineProps) {
  const L = geometry.length;
  const seg = L * segment;
  const { t, x, y } = geometry.samples;

  const strokeProps = useAnimatedProps(() => {
    const p = progress.value;
    return { strokeDashoffset: mode === 'draw' ? L * (1 - p) : seg - p * (L + seg) };
  });
  const glowProps = useAnimatedProps(() => {
    const p = progress.value;
    return { strokeDashoffset: mode === 'draw' ? L * (1 - p) : seg - p * (L + seg) };
  });
  const needleProps = useAnimatedProps(() => {
    const p = progress.value;
    const head = mode === 'draw' ? p : Math.min(1, Math.max(0, (p * (L + seg)) / L));
    const visible = mode === 'draw'
      ? interpolate(p, [0, 0.03, 0.94, 1], [0, 1, 1, 0], Extrapolation.CLAMP)
      : interpolate(head, [0, 0.04, 0.96, 1], [0, 1, 1, 0], Extrapolation.CLAMP);
    return {
      cx: interpolate(head, t, x, Extrapolation.CLAMP),
      cy: interpolate(head, t, y, Extrapolation.CLAMP),
      opacity: visible,
    };
  });

  const dash = mode === 'draw' ? [L, L] : [seg, L + seg];

  return (
    <Svg width={width} height={height} style={style} pointerEvents="none">
      {glow ? (
        <AnimatedPath
          d={geometry.d}
          stroke={color}
          strokeOpacity={THREAD.glowOpacity}
          strokeWidth={THREAD.glow}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={dash}
          animatedProps={glowProps}
        />
      ) : null}
      <AnimatedPath
        d={geometry.d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={dash}
        animatedProps={strokeProps}
      />
      {needle ? <AnimatedCircle r={2.6} fill={color} animatedProps={needleProps} /> : null}
      {children}
    </Svg>
  );
}

function useMeasuredWidth(initial = 0) {
  const [width, setWidth] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };
  return { width, onLayout };
}

// ─── Glow: soft radial light behind a hero object ────────────────────────────

let glowIds = 0;

/** Vector radial glow (crisp on every platform, unlike blurred shadows). */
export function Glow({ size, color, intensity = 0.14, style }: { size: number; color: string; intensity?: number; style?: StyleProp<ViewStyle> }) {
  const id = useMemo(() => `bt-glow-${++glowIds}`, []);
  return (
    <Svg width={size} height={size} style={style} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={intensity} />
          <Stop offset="0.45" stopColor={color} stopOpacity={intensity * 0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

// ─── ThreadDraw: self-playing draw-on ────────────────────────────────────────

export function ThreadDraw({
  height,
  color,
  delay = 0,
  duration = MOTION.welcomeDrawMs,
  onLanded,
  style,
}: {
  height: number;
  color: string;
  delay?: number;
  duration?: number;
  /** Fired when the thread finishes drawing (immediately under Reduce Motion). */
  onLanded?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceMotion, stitchTick } = useOnboardingMotion();
  const { width, onLayout } = useMeasuredWidth();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const geometry = useMemo(() => welcomeThread(width, height), [width, height]);
  const started = useRef(false);

  const landed = () => {
    stitchTick();
    onLanded?.();
  };

  useEffect(() => {
    if (!width || started.current) return;
    started.current = true;
    if (reduceMotion) {
      progress.value = 1;
      onLanded?.();
      return;
    }
    progress.value = withDelay(
      delay,
      withTiming(1, { duration, easing: MOTION.draw }, (finished) => {
        if (finished) runOnJS(landed)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  // Cancelling reports finished=false, so no late haptic after unmount.
  useEffect(() => () => cancelAnimation(progress), [progress]);

  return (
    <View style={[{ height }, style]} onLayout={onLayout} pointerEvents="none">
      {width > 0 ? (
        <ThreadLine geometry={geometry} width={width} height={height} progress={progress} color={color} />
      ) : null}
    </View>
  );
}

// ─── ThreadProgress: the stepper indicator ───────────────────────────────────

// Remembered across mounts so the thread never "rewinds" when the header
// unmounts for a full-screen step and a new indicator mounts after it.
let lastProgressFraction = 0;

export function ThreadProgress({
  current = 0,
  total = 2,
  fraction,
  showNodes = true,
  height = 16,
  color,
  trackColor,
  accessibilityLabel,
  style,
}: {
  current?: number;
  total?: number;
  /** Continuous mode (0–1) — ignores `current`/`total` for the fill. */
  fraction?: number;
  showNodes?: boolean;
  height?: number;
  color: string;
  trackColor: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceMotion, stitchTick } = useOnboardingMotion();
  const { width, onLayout } = useMeasuredWidth();
  const nodes = fraction === undefined ? Math.max(2, total) : 6;
  const geometry = useMemo(() => progressThread(width, height, nodes), [width, height, nodes]);
  const safeCurrent = Math.max(0, Math.min(current, nodes - 1));
  const target = fraction === undefined
    ? geometry.marks[safeCurrent] ?? 0
    : Math.max(0, Math.min(1, fraction));

  const progress = useSharedValue(fraction === undefined ? lastProgressFraction : 0);
  const knot = useSharedValue(0);

  useEffect(() => {
    if (!width) return;
    if (fraction === undefined) lastProgressFraction = target;
    if (reduceMotion) {
      progress.value = target;
      return;
    }
    const moved = Math.abs(progress.value - target) > 0.001;
    progress.value = withTiming(target, { duration: MOTION.progressMs, easing: MOTION.draw }, (finished) => {
      if (finished && moved) {
        knot.value = 0;
        knot.value = withTiming(1, { duration: 520 });
        runOnJS(stitchTick)();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, target, reduceMotion]);

  const knotPoint = geometry.markPoints[safeCurrent];
  const haloProps = useAnimatedProps(() => ({
    r: interpolate(knot.value, [0, 1], [3, 9]),
    opacity: interpolate(knot.value, [0, 0.15, 1], [0, 0.45, 0]),
  }));

  return (
    <View
      style={[{ height }, style]}
      onLayout={onLayout}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={fraction === undefined
        ? { min: 1, max: nodes, now: safeCurrent + 1 }
        : { min: 0, max: 100, now: Math.round(target * 100) }}
    >
      {width > 0 ? (
        <>
          {/* The stitch holes the thread will pass through. */}
          <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path
              d={geometry.d}
              stroke={trackColor}
              strokeWidth={1}
              strokeDasharray={[2, 5]}
              strokeLinecap="round"
              fill="none"
            />
          </Svg>
          <ThreadLine
            geometry={geometry}
            width={width}
            height={height}
            progress={progress}
            color={color}
            needle={false}
            style={StyleSheet.absoluteFill}
          >
            {showNodes && fraction === undefined
              ? geometry.markPoints.map((pt, i) => (
                  i <= safeCurrent ? (
                    <Circle key={i} cx={pt.x} cy={pt.y} r={i === safeCurrent ? 3 : 1.8} fill={color} />
                  ) : (
                    <Circle key={i} cx={pt.x} cy={pt.y} r={1.8} fill="none" stroke={trackColor} strokeWidth={1} />
                  )
                ))
              : null}
            {showNodes && fraction === undefined && knotPoint && !reduceMotion ? (
              <AnimatedCircle cx={knotPoint.x} cy={knotPoint.y} fill="none" stroke={color} strokeWidth={1} animatedProps={haloProps} />
            ) : null}
          </ThreadLine>
        </>
      ) : null}
    </View>
  );
}

// ─── ThreadWeave: the step-to-step transition ────────────────────────────────

export function ThreadWeave({
  stepKey,
  direction,
  height = 132,
  color,
  style,
}: {
  /** Changing this plays one weave. */
  stepKey: string | number;
  direction: 1 | -1;
  height?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceMotion } = useOnboardingMotion();
  const { width, onLayout } = useMeasuredWidth();
  const progress = useSharedValue(1);
  const firstKey = useRef(stepKey);
  const geometry = useMemo(() => weaveThread(width, height, direction), [width, height, direction]);

  useEffect(() => {
    if (reduceMotion || stepKey === firstKey.current) return;
    firstKey.current = stepKey;
    progress.value = 0;
    progress.value = withTiming(1, { duration: MOTION.weaveMs, easing: MOTION.draw });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, reduceMotion]);

  if (reduceMotion) return null;
  return (
    <View style={[{ height }, style]} onLayout={onLayout} pointerEvents="none">
      {width > 0 ? (
        <ThreadLine
          geometry={geometry}
          width={width}
          height={height}
          progress={progress}
          mode="segment"
          segment={0.5}
          color={color}
        />
      ) : null}
    </View>
  );
}

// ─── ThreadLogoStitch: the finale ────────────────────────────────────────────

export function ThreadLogoStitch({
  size = 128,
  color,
  delay = 200,
  onStitched,
}: {
  size?: number;
  color: string;
  delay?: number;
  /** Fired once the thread has tied off (immediately under Reduce Motion). Owns the landing haptic. */
  onStitched?: () => void;
}) {
  const { reduceMotion, stitchTick } = useOnboardingMotion();
  const geometry = useMemo(() => logoStitchThread(size), [size]);
  const canvasWidth = size * (1 + LOGO_STITCH_LEAD_IN);
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const outline = useSharedValue(reduceMotion ? 0 : 1);
  const logo = useSharedValue(reduceMotion ? 1 : 0);
  const glow = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      onStitched?.();
      return;
    }
    // The caller owns the landing haptic when it listens for it.
    const tiedOff = () => {
      if (onStitched) onStitched();
      else stitchTick();
    };
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: MOTION.finaleDrawMs, easing: MOTION.draw }, (finished) => {
        if (!finished) return;
        outline.value = withTiming(0, { duration: 520 });
        glow.value = withTiming(1, { duration: 700 });
        logo.value = withSpring(1, { damping: 16, stiffness: 140 });
        runOnJS(tiedOff)();
      }),
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outlineStyle = useAnimatedStyle(() => ({ opacity: outline.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logo.value,
    transform: [{ scale: interpolate(logo.value, [0, 1], [0.92, 1]) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.9,
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.6, 1]) }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        pointerEvents="none"
        style={[styles.finaleGlow, { left: -size * 0.6, top: -size * 0.6 }, glowStyle]}
      >
        <Glow size={size * 2.2} color={color} intensity={0.16} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -size * LOGO_STITCH_LEAD_IN, top: 0 }, outlineStyle]}>
        <ThreadLine geometry={geometry} width={canvasWidth} height={size} progress={progress} color={color} />
      </Animated.View>
      <Animated.View style={logoStyle}>
        <BrandthreadLogo size={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  finaleGlow: { position: 'absolute' },
});
