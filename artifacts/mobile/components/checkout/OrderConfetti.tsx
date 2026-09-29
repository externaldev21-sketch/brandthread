/**
 * One-shot monochrome confetti for a freshly confirmed order: ribbons +
 * squares in white/silver/light-and-mid grey, bursting from the success
 * check and falling with gentle gravity over ~2.5s, then gone for good.
 *
 * Mirrors the physics/reanimated approach of
 * components/thread-cash/CelebrationHost.tsx's existing money-burst
 * celebration (a falling drop from the top here, rather than an outward
 * burst, and no bill sprite / green palette) — the same proven, lightweight,
 * worklet-driven particle system, not a new dependency. Runs identically on
 * native and web, since react-native-reanimated already supports both.
 *
 * Skipped entirely under Reduce Motion. The CALLER decides *whether* `play`
 * is ever true at all — see OrderConfirmation.tsx's own once-per-order
 * guard, so reopening an already-confirmed order never replays this.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { hapticSuccess } from '@/lib/haptics';

const PIECE_COUNT = 40;
const FALL_DURATION_MS = 2500;
// theme-exempt: fixed monochrome confetti palette per spec (white/silver/grey).
const COLORS = ['#FFFFFF', '#E6E6E6', '#BFBFBF', '#8F8F8F'];

type PieceKind = 'ribbon' | 'square';
type PieceSpec = {
  kind: PieceKind;
  size: number;
  color: string;
  x: number;
  fallDistance: number;
  drift: number;
  spin: number;
  delay: number;
};

function buildPieces(seed: number, spread: number): PieceSpec[] {
  const pieces: PieceSpec[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    // Deterministic-ish pseudo-random spread (index + seed), same trick
    // CelebrationHost.tsx uses, so a burst looks organic with no new dep.
    const r = (n: number) => {
      const x = Math.sin(seed * 999 + i * 41.7 + n * 6.13) * 10000;
      return x - Math.floor(x);
    };
    pieces.push({
      kind: r(1) < 0.4 ? 'ribbon' : 'square',
      size: 6 + r(2) * 7,
      color: COLORS[Math.floor(r(3) * COLORS.length)],
      x: (r(4) - 0.5) * spread,
      fallDistance: 260 + r(5) * 240,
      drift: (r(6) - 0.5) * 130,
      spin: (r(7) - 0.5) * 720,
      delay: r(8) * 220,
    });
  }
  return pieces;
}

function ConfettiPiece({ spec }: { spec: PieceSpec }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      spec.delay,
      withTiming(1, { duration: FALL_DURATION_MS - spec.delay, easing: Easing.out(Easing.quad) }),
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const fall = spec.fallDistance * t * t;
    const drift = Math.sin(t * Math.PI * 2) * spec.drift * t;
    const opacity = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2);
    return {
      opacity,
      transform: [
        { translateX: spec.x + drift },
        { translateY: fall },
        { rotate: `${spec.spin * t}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        style,
        spec.kind === 'ribbon'
          ? { width: spec.size * 0.4, height: spec.size * 2.1, backgroundColor: spec.color }
          : { width: spec.size, height: spec.size, backgroundColor: spec.color },
      ]}
    />
  );
}

/** Renders the falling burst while `play` is true; auto-clears itself after the fall completes. */
export function OrderConfetti({ play }: { play: boolean }) {
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const pieces = useMemo(() => buildPieces(Date.now(), Math.min(width * 0.85, 340)), [width]);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduceMotion(!!v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!play || reduceMotion) return;
    setVisible(true);
    hapticSuccess();
    const timer = setTimeout(() => setVisible(false), FALL_DURATION_MS + 200);
    return () => clearTimeout(timer);
  }, [play, reduceMotion]);

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]} testID="order-confetti">
      <View style={styles.origin}>
        {pieces.map((spec, i) => <ConfettiPiece key={i} spec={spec} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 9998, elevation: 9998 },
  origin: { position: 'absolute', top: 0, left: '50%', width: 1, height: 1, alignItems: 'center' },
  piece: { position: 'absolute', borderRadius: 1 },
});
