/**
 * Double-tap-to-like heart burst — particle layer.
 *
 * The feed's own `heartBurst`/`heartBurstScale` (classic `Animated` API, in
 * app/(tabs)/feed.tsx) already pops a single big heart glyph in and fades it
 * out. That alone reads as a scale/fade pop, not the "burst" Instagram's
 * double-tap is known for (see PR body for the Mobbin reference) — the
 * signature bit is a handful of small marks flying outward from the tap
 * point. This component adds just that: a fixed ring of small monochrome
 * heart glyphs that fling outward and fade as `trigger` changes.
 *
 * New animation code here uses Reanimated (UI thread) per the project's
 * "no third animation approach" rule — the existing big-heart pop stays on
 * the classic `Animated` API untouched, this only adds a second, separate
 * layer next to it.
 */
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing, type SharedValue } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { ON_DARK } from '@/lib/theme';

// 8 particles, evenly spaced around the tap point, each with a slightly
// different size/distance so the burst doesn't read as a perfect mechanical
// ring. Angles start at -90deg (straight up) and go clockwise.
const PARTICLES = Array.from({ length: 8 }, (_, i) => {
  const angle = (-90 + i * 45) * (Math.PI / 180);
  const distance = 46 + (i % 2 === 0 ? 10 : 0);
  const size = i % 3 === 0 ? 16 : 12;
  return {
    dx: Math.cos(angle) * distance,
    dy: Math.sin(angle) * distance,
    size,
    delay: (i % 4) * 18,
  };
});

const DURATION = 480;

function Particle({ dx, dy, size, delay, progress }: { dx: number; dy: number; size: number; delay: number; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    // Local 0->1 progress for this particle, offset by its stagger delay,
    // fit back into the shared [0,1] timeline so all particles still
    // finish together.
    const localStart = delay / DURATION;
    const local = Math.max(0, Math.min(1, (progress.value - localStart) / (1 - localStart)));
    const eased = 1 - Math.pow(1 - local, 2);
    const fade = local < 0.55 ? 1 : 1 - (local - 0.55) / 0.45;
    return {
      opacity: Math.max(0, fade),
      transform: [
        { translateX: dx * eased },
        { translateY: dy * eased },
        { scale: 0.4 + eased * 0.6 },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.particle, style]}>
      <Feather name="heart" size={size} color={ON_DARK} />
    </Animated.View>
  );
}

/** `trigger` is any value that changes on each double-tap (a counter works
 * well) — every change replays the burst from 0. */
export function HeartBurstParticles({ trigger }: { trigger: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (trigger === 0) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: DURATION, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <Animated.View pointerEvents="none" style={styles.host}>
      {PARTICLES.map((p, i) => (
        <Particle key={i} dx={p.dx} dy={p.dy} size={p.size} delay={p.delay} progress={progress} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: '38%',
    left: '50%',
    width: 0,
    height: 0,
  },
  particle: {
    position: 'absolute',
    left: 0,
    top: 0,
    marginLeft: -8,
    marginTop: -8,
  },
});
