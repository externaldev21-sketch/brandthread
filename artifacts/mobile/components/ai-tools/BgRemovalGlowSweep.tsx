/**
 * Brandthread — Remove Background sparkle
 *
 * What the seller sees while their background is removed, all black / white /
 * silver:
 *  1. working: the request is in flight. A silver sheen glides across the
 *     photo, a field of glitter twinkles over it and a soft scanline sweeps,
 *     so the wait reads as "something is happening to this photo".
 *  2. dissolving: the real cutout has arrived. A bright line runs down the
 *     photo once; behind it the background breaks into silver glitter that
 *     sparkles, drifts up and fades, leaving the checkerboard. The subject
 *     never flickers.
 *  3. glisten: a brief silver rim light travels around the cutout's edge,
 *     then onSettled() hands the result to the screen.
 *
 * "Only the background sparkles" needs no segmentation polygon: the finished
 * cutout PNG is the top layer, so every effect beneath it (glitter, line,
 * the dissolving original) is only visible where the cutout is transparent,
 * i.e. exactly the areas being removed. The rim glisten is the cutout itself
 * tinted silver and nudged a pixel or two in each direction, drawn just under
 * the cutout, so it only shows as a thin outline.
 *
 * All animation runs on the UI thread (Reanimated shared values; no React
 * re-renders while animating). Works on native and web (no Skia). Reduced
 * motion skips straight to the result.
 */
import React, { useEffect, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Checkerboard from '@/components/design/Checkerboard';

interface Props {
  width: number;
  height: number;
  originalUri: string;
  /** Present once the real result is in hand; undefined while the request runs. */
  cutoutUri?: string | null;
  onSettled?: () => void;
}

const WHITE = '#FFFFFF';
const SILVER = '#C0C0C0';
const SILVER_LIGHT = '#E6E6E6';

const DISSOLVE_MS = 2400;
const GLISTEN_MS = 1100;
const TWINKLES = 28; // glitter over the photo while working
const STARS = 48; // sparkles born behind the line while dissolving
const DUST = 96; // fine silver dust behind the line
const TRAIL = 0.26; // fraction of the photo height the dissolving glitter lives behind the line
// Rim glisten: a bright silver ring 2px out over a soft dark halo 4px out, so the
// glint reads on any backdrop, the light checkerboard included.
const RIM_INNER = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1.4, -1.4], [1.4, 1.4], [-1.4, 1.4], [1.4, -1.4]] as const;
const RIM_OUTER = [[-4, 0], [4, 0], [0, -4], [0, 4]] as const;

// Deterministic pseudo-random so particles are stable across renders.
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A four-point glint: two crossed arms and a bright core. */
function Glint({ size, color }: { size: number; color: string }) {
  return (
    <>
      <View style={[st.arm, st.glow, { width: size, height: 1.8, top: size / 2 - 0.9, backgroundColor: color }]} />
      <View style={[st.arm, st.glow, { width: 1.8, height: size, left: size / 2 - 0.9, backgroundColor: color }]} />
      <View style={[st.core, { backgroundColor: WHITE, left: size / 2 - 2, top: size / 2 - 2 }]} />
    </>
  );
}

/** Working phase: twinkles in place on its own rhythm. */
function Twinkle({ clock, x, y, size, phase, speed, color }: {
  clock: SharedValue<number>; x: number; y: number; size: number; phase: number; speed: number; color: string;
}) {
  const style = useAnimatedStyle(() => {
    const wave = Math.sin((clock.value * speed + phase) * Math.PI * 2);
    const k = Math.max(0, wave) ** 3; // mostly dark, with sharp flashes
    return { opacity: k, transform: [{ scale: 0.35 + k * 0.85 }, { rotate: `${clock.value * 90 * speed}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }, style]}>
      <Glint size={size} color={color} />
    </Animated.View>
  );
}

/** Dissolving phase: born as the line passes, flares, drifts up and fades. */
function Star({ pos, dissolving, clock, x, y, size, bright, h, phase }: {
  pos: SharedValue<number>; dissolving: SharedValue<number>; clock: SharedValue<number>;
  x: number; y: number; size: number; bright: boolean; h: number; phase: number;
}) {
  const lineY = y / h;
  const style = useAnimatedStyle(() => {
    const age = pos.value - lineY; // > 0 once the line has passed
    const alive = dissolving.value === 1 && age > -0.015 && age < TRAIL;
    const life = alive ? Math.sin(((age + 0.015) / (TRAIL + 0.015)) * Math.PI) : 0;
    const flicker = 0.65 + 0.35 * Math.sin((clock.value * 6 + phase) * Math.PI * 2);
    const k = life * flicker;
    return {
      opacity: k,
      transform: [{ translateY: -age * 60 }, { rotate: `${age * 300}deg` }, { scale: 0.3 + k * 0.95 }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }, style]}>
      <Glint size={size} color={bright ? WHITE : SILVER} />
    </Animated.View>
  );
}

function Dust({ pos, dissolving, x, y, size, h, drift }: {
  pos: SharedValue<number>; dissolving: SharedValue<number>; x: number; y: number; size: number; h: number; drift: number;
}) {
  const lineY = y / h;
  const style = useAnimatedStyle(() => {
    const age = pos.value - lineY;
    const alive = dissolving.value === 1 && age > 0 && age < TRAIL * 0.9;
    const k = alive ? 1 - age / (TRAIL * 0.9) : 0;
    return { opacity: k, transform: [{ translateY: -age * 42 }, { translateX: age * drift }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: SILVER_LIGHT }, st.glow, style]}
    />
  );
}

export default function BgRemovalGlowSweep({ width, height, originalUri, cutoutUri, onSettled }: Props) {
  const reduceMotion = useReducedMotion();
  const pos = useSharedValue(0); // scanline position, 0 (top) .. 1 (bottom)
  const dissolving = useSharedValue(0);
  const clock = useSharedValue(0); // free-running 0..1 for twinkles/flicker
  const sheen = useSharedValue(0);
  const working = useSharedValue(1); // 1 while waiting for the result, fades to 0
  const rim = useSharedValue(0);
  const resolved = !!cutoutUri;

  // Working: sheen glides, glitter twinkles, scanline ping-pongs until a result exists.
  useEffect(() => {
    if (resolved) return;
    dissolving.value = 0;
    working.value = 1;
    pos.value = 0;
    if (reduceMotion) { pos.value = 0.5; return; }
    clock.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1, false);
    sheen.value = withRepeat(withSequence(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), withDelay(350, withTiming(0, { duration: 0 }))), -1, false);
    pos.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => { cancelAnimation(pos); cancelAnimation(sheen); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, reduceMotion]);

  // Dissolving, then the rim glisten, then hand over.
  useEffect(() => {
    if (!resolved) return;
    cancelAnimation(pos);
    cancelAnimation(sheen);
    if (reduceMotion) {
      dissolving.value = 1;
      working.value = 0;
      pos.value = 1;
      onSettled?.();
      return;
    }
    const done = () => { onSettled?.(); };
    working.value = withTiming(0, { duration: 260 });
    pos.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.quad) }, (fin) => {
      'worklet';
      if (!fin) return;
      dissolving.value = 1;
      pos.value = withTiming(1, { duration: DISSOLVE_MS, easing: Easing.inOut(Easing.cubic) }, (f2) => {
        'worklet';
        if (!f2) return;
        rim.value = withSequence(
          withTiming(1, { duration: GLISTEN_MS * 0.4, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: GLISTEN_MS * 0.6, easing: Easing.in(Easing.quad) }, (f3) => {
            'worklet';
            if (f3) runOnJS(done)();
          }),
        );
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const twinkles = useMemo(() => Array.from({ length: TWINKLES }, (_, i) => ({
    x: 10 + rand(i + 701) * (width - 20), y: 10 + rand(i + 801) * (height - 20),
    size: 7 + rand(i + 901) * 12, phase: rand(i + 1001), speed: 1 + Math.floor(rand(i + 1101) * 3),
    color: rand(i + 1201) > 0.4 ? WHITE : SILVER,
  })), [width, height]);
  const stars = useMemo(() => Array.from({ length: STARS }, (_, i) => ({
    x: 8 + rand(i + 1) * (width - 16), y: 8 + rand(i + 101) * (height - 16),
    size: 9 + rand(i + 201) * 14, bright: rand(i + 301) > 0.35, phase: rand(i + 351),
  })), [width, height]);
  const dust = useMemo(() => Array.from({ length: DUST }, (_, i) => ({
    x: rand(i + 401) * width, y: rand(i + 501) * height, size: 1.5 + rand(i + 601) * 2.5, drift: (rand(i + 651) - 0.5) * 40,
  })), [width, height]);

  // Original photo: only the part still below the line. Above it the
  // background is gone (checkerboard) and only the cutout remains.
  const clipStyle = useAnimatedStyle(() => {
    const d = dissolving.value === 1 ? pos.value : 0;
    return { top: d * height, height: (1 - d) * height };
  });
  const clipImgStyle = useAnimatedStyle(() => {
    const d = dissolving.value === 1 ? pos.value : 0;
    return { top: -d * height };
  });
  const veilStyle = useAnimatedStyle(() => ({ opacity: 0.18 * working.value }));
  const workingStyle = useAnimatedStyle(() => ({ opacity: working.value }));
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.8 + sheen.value * width * 2.2 }, { rotate: '20deg' }] }));
  const lineStyle = useAnimatedStyle(() => ({ top: pos.value * height - 1, opacity: dissolving.value === 1 ? (pos.value < 0.995 ? 1 : 0) : 0.55 }));
  const trailStyle = useAnimatedStyle(() => ({ top: pos.value * height - height * TRAIL, opacity: dissolving.value === 1 ? 1 : 0 }));
  const rimStyle = useAnimatedStyle(() => ({ opacity: rim.value }));

  return (
    <View style={{ width, height, overflow: 'hidden' }} pointerEvents="none" testID="bg-removal-sparkle">
      <Checkerboard />
      <Animated.View style={[{ position: 'absolute', left: 0, width, overflow: 'hidden' }, clipStyle]}>
        <Animated.Image source={{ uri: originalUri }} resizeMode="cover" style={[{ position: 'absolute', left: 0, width, height }, clipImgStyle]} />
      </Animated.View>

      {/* Working: a dark veil so the silver reads, a gliding sheen and twinkling glitter. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.veil, veilStyle]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, workingStyle]}>
        <Animated.View style={[{ position: 'absolute', top: -height * 0.3, height: height * 1.6, width: width * 0.35 }, sheenStyle]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(230,230,230,0.20)', 'rgba(255,255,255,0.38)', 'rgba(192,192,192,0.16)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        {twinkles.map((t, i) => <Twinkle key={`t${i}`} clock={clock} {...t} />)}
      </Animated.View>

      {/* Dissolving: glitter born behind the line over the background. */}
      {dust.map((d, i) => <Dust key={`d${i}`} pos={pos} dissolving={dissolving} {...d} h={height} />)}
      {stars.map((s, i) => <Star key={`s${i}`} pos={pos} dissolving={dissolving} clock={clock} {...s} h={height} />)}

      <Animated.View style={[{ position: 'absolute', left: 0, width, height: height * TRAIL }, trailStyle]}>
        {/* The background breaks up through a dark silver veil (glitter reads on it, even over the light checkerboard). */}
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(12,12,12,0.45)', 'rgba(40,40,40,0.72)']} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, width, height: 2 }, lineStyle]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', WHITE, WHITE, 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={st.line}
        />
      </Animated.View>

      {/* Glisten: the cutout tinted silver, nudged out by a pixel or two, under the cutout itself. */}
      {cutoutUri ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, rimStyle]}>
          {RIM_OUTER.map(([dx, dy], i) => (
            <Image
              key={`o${i}`}
              source={{ uri: cutoutUri }}
              resizeMode="cover"
              style={{ position: 'absolute', left: dx, top: dy, width, height, tintColor: '#000000', opacity: 0.4 }}
            />
          ))}
          {RIM_INNER.map(([dx, dy], i) => (
            <Image
              key={`i${i}`}
              source={{ uri: cutoutUri }}
              resizeMode="cover"
              style={{ position: 'absolute', left: dx, top: dy, width, height, tintColor: SILVER_LIGHT }}
            />
          ))}
        </Animated.View>
      ) : null}

      {/* Top layer: the subject. Everything above is only visible where it is transparent. */}
      {cutoutUri ? (
        <Image source={{ uri: cutoutUri }} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, width, height }} />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  arm: { position: 'absolute', left: 0, borderRadius: 1 },
  core: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
  glow: { shadowColor: '#000000', shadowOpacity: 0.7, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  veil: { backgroundColor: '#000000' },
  line: { flex: 1, shadowColor: WHITE, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
});
