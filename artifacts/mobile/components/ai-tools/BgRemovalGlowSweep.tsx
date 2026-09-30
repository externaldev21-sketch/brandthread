/**
 * Brandthread — Remove Background sweep
 *
 * The shiny "glitch" pass Dev asked for, modelled on Photoroom's removal
 * screen: a scanline travels down the photo and, behind it, ONLY the
 * background dissolves — glitter, pixel-glitch slices and a silver trail —
 * while the subject stays solid.
 *
 * How the "background only" part works without a segmentation polygon: the
 * finished cutout PNG is drawn as the top layer, so everything beneath it
 * (the scanline, sparkles, glitch slices, the original photo itself) is only
 * ever visible where the cutout is transparent — i.e. exactly the areas being
 * removed.
 *
 * Two phases, both on the UI thread (Reanimated shared values, no React
 * re-renders while animating):
 *  - waiting: the request is in flight and there is no cutout yet, so a single
 *    scanline sweeps the photo back and forth.
 *  - dissolving: the cutout has arrived. The line returns to the top, then runs
 *    down once (~2s) wiping the background away. Calls onSettled when done.
 *
 * Works on native and web (no Skia dependency — Skia is not loaded on web).
 */
import React, { useEffect, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withTiming, type SharedValue,
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

const DISSOLVE_MS = 2000;
const GLITCH_BANDS = 6;
const STARS = 26;
const DOTS = 38;
const TRAIL = 0.22; // fraction of the photo height the glitter lives behind the line

// Deterministic pseudo-random so particles are stable across renders.
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function Star({ pos, dissolving, x, y, size, bright, h }: {
  pos: SharedValue<number>; dissolving: SharedValue<number>; x: number; y: number; size: number; bright: boolean; h: number;
}) {
  const lineY = y / h;
  const style = useAnimatedStyle(() => {
    const age = pos.value - lineY; // >0 once the line has passed
    const visible = dissolving.value === 1 && age > -0.02 && age < TRAIL;
    const k = visible ? Math.sin(((age + 0.02) / (TRAIL + 0.02)) * Math.PI) : 0;
    return {
      opacity: k,
      transform: [
        { translateY: -age * 46 },
        { rotate: `${age * 260}deg` },
        { scale: 0.3 + k * 0.9 },
      ],
    };
  });
  const color = bright ? '#FFFFFF' : '#C0C0C0';
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }, style]}
    >
      <View style={[st.starArm, { width: size, height: 2, top: size / 2 - 1, backgroundColor: color }]} />
      <View style={[st.starArm, { width: 2, height: size, left: size / 2 - 1, backgroundColor: color }]} />
      <View style={[st.starCore, { backgroundColor: color, left: size / 2 - 2.5, top: size / 2 - 2.5 }]} />
    </Animated.View>
  );
}

function Dot({ pos, dissolving, x, y, size, h }: { pos: SharedValue<number>; dissolving: SharedValue<number>; x: number; y: number; size: number; h: number }) {
  const lineY = y / h;
  const style = useAnimatedStyle(() => {
    const age = pos.value - lineY;
    const visible = dissolving.value === 1 && age > 0 && age < TRAIL * 0.8;
    const k = visible ? 1 - age / (TRAIL * 0.8) : 0;
    return { opacity: k, transform: [{ translateY: -age * 30 }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFFFFF' }, style]}
    />
  );
}

/** One horizontal slice of the original photo that jitters sideways just behind the line. */
function GlitchBand({ pos, dissolving, index, uri, w, h }: {
  pos: SharedValue<number>; dissolving: SharedValue<number>; index: number; uri: string; w: number; h: number;
}) {
  const bandH = Math.max(6, Math.round(h * (0.012 + rand(index + 3) * 0.022)));
  const back = (0.02 + index * 0.028) * h;
  const style = useAnimatedStyle(() => {
    const top = pos.value * h - back;
    const jitter = Math.sin(pos.value * 140 + index * 7.3) * (10 + index * 3);
    const on = dissolving.value === 1 && pos.value > 0.02 && pos.value < 0.985;
    return {
      top,
      opacity: on ? (Math.sin(pos.value * 90 + index * 2.1) > -0.15 ? 0.9 : 0) : 0,
      transform: [{ translateX: jitter }],
    };
  });
  const imgStyle = useAnimatedStyle(() => ({ top: -(pos.value * h - back) }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, width: w, height: bandH, overflow: 'hidden' }, style]}>
      <Animated.Image source={{ uri }} resizeMode="cover" style={[{ position: 'absolute', left: 0, width: w, height: h }, imgStyle]} />
    </Animated.View>
  );
}

export default function BgRemovalGlowSweep({ width, height, originalUri, cutoutUri, onSettled }: Props) {
  const reduceMotion = useReducedMotion();
  const pos = useSharedValue(0);
  const dissolving = useSharedValue(0);
  const resolved = !!cutoutUri;

  // Waiting: scanline ping-pongs until a result exists.
  useEffect(() => {
    if (resolved) return;
    dissolving.value = 0;
    pos.value = 0;
    if (reduceMotion) { pos.value = 0.5; return; }
    pos.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, reduceMotion]);

  // Dissolving: return to the top, then one pass that wipes the background.
  useEffect(() => {
    if (!resolved) return;
    cancelAnimation(pos);
    if (reduceMotion) {
      dissolving.value = 1;
      pos.value = 1;
      onSettled?.();
      return;
    }
    const done = () => { onSettled?.(); };
    pos.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }, (fin) => {
      'worklet';
      if (!fin) return;
      dissolving.value = 1;
      pos.value = withTiming(1, { duration: DISSOLVE_MS, easing: Easing.inOut(Easing.cubic) }, (f2) => {
        'worklet';
        if (f2) runOnJS(done)();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const stars = useMemo(() => Array.from({ length: STARS }, (_, i) => ({
    x: 8 + rand(i + 1) * (width - 16), y: 8 + rand(i + 101) * (height - 16),
    size: 9 + rand(i + 201) * 13, bright: rand(i + 301) > 0.35,
  })), [width, height]);
  const dots = useMemo(() => Array.from({ length: DOTS }, (_, i) => ({
    x: rand(i + 401) * width, y: rand(i + 501) * height, size: 2 + rand(i + 601) * 2.5,
  })), [width, height]);

  // Original photo: only the part still below the line. Once dissolving, the
  // part above the line is gone (checkerboard shows through).
  const clipStyle = useAnimatedStyle(() => {
    const d = dissolving.value === 1 ? pos.value : 0;
    return { top: d * height, height: (1 - d) * height };
  });
  const clipImgStyle = useAnimatedStyle(() => {
    const d = dissolving.value === 1 ? pos.value : 0;
    return { top: -d * height };
  });
  const lineStyle = useAnimatedStyle(() => ({ top: pos.value * height - 1 }));
  const trailStyle = useAnimatedStyle(() => ({ top: pos.value * height - height * TRAIL }));

  return (
    <View style={{ width, height, overflow: 'hidden' }} pointerEvents="none">
      <Checkerboard />
      <Animated.View style={[{ position: 'absolute', left: 0, width, overflow: 'hidden' }, clipStyle]}>
        <Animated.Image source={{ uri: originalUri }} resizeMode="cover" style={[{ position: 'absolute', left: 0, width, height }, clipImgStyle]} />
      </Animated.View>

      {Array.from({ length: GLITCH_BANDS }, (_, i) => (
        <GlitchBand key={i} pos={pos} dissolving={dissolving} index={i} uri={originalUri} w={width} h={height} />
      ))}
      {dots.map((d, i) => <Dot key={`d${i}`} pos={pos} dissolving={dissolving} x={d.x} y={d.y} size={d.size} h={height} />)}
      {stars.map((s, i) => <Star key={`s${i}`} pos={pos} dissolving={dissolving} x={s.x} y={s.y} size={s.size} bright={s.bright} h={height} />)}

      <Animated.View style={[{ position: 'absolute', left: 0, width, height: height * TRAIL }, trailStyle]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.22)']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, width, height: 2 }, lineStyle]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', '#FFFFFF', '#FFFFFF', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={st.line}
        />
      </Animated.View>

      {/* Top layer: the subject. Everything above is only visible where it is transparent. */}
      {cutoutUri ? (
        <Image source={{ uri: cutoutUri }} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, width, height }} />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  starArm: { position: 'absolute', left: 0, borderRadius: 1 },
  starCore: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5 },
  line: { flex: 1, shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
});
