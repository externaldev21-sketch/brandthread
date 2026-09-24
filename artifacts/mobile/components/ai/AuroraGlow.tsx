/**
 * AuroraGlow — the Brandthread AI screen's signature ambient background.
 *
 * A dark stage with 2–3 soft, slowly breathing silver/platinum/cool-grey
 * blobs of light. Pure Reanimated transforms + opacity (no Skia dependency
 * in this codebase yet) so it stays on the UI thread at 60fps and costs
 * almost nothing on battery — nothing re-renders JS-side while it animates.
 *
 * `thinking` brightens/pulses it while the AI is generating a reply and
 * calms it back down when the reply lands. `useReducedMotion()` (Reanimated's
 * OS-level signal) freezes the breathing/pulse loops entirely; the thinking
 * state still cross-fades once, since a single state-driven fade isn't the
 * kind of decorative motion Reduce Motion asks screens to remove.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface AuroraGlowProps {
  /** True while the AI is generating — brightens and quickens the glow. */
  thinking?: boolean;
  style?: object;
}

const BLOBS = [
  { colors: ['#F7F7FAB0', '#C7CCD400'], size: 340, x: -60, y: -40, duration: 9000 },
  { colors: ['#DADEE6A6', '#9AA0AB00'], size: 300, x: 90, y: 30, duration: 11000 },
  { colors: ['#EAEAF0A0', '#B8BEC800'], size: 260, x: -10, y: 90, duration: 7600 },
] as const;

function AuroraBlob({
  blob,
  reduceMotion,
  thinking,
}: {
  blob: (typeof BLOBS)[number];
  reduceMotion: boolean;
  thinking: boolean;
}) {
  const breathe = useSharedValue(0);
  const glowValue = useSharedValue(thinking ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      breathe.value = 0.5;
      return;
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: blob.duration, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: blob.duration, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [reduceMotion, blob.duration, breathe]);

  useEffect(() => {
    glowValue.value = withTiming(thinking ? 1 : 0, { duration: 500 });
  }, [thinking, glowValue]);

  const animatedStyle = useAnimatedStyle(() => {
    const drift = 14 + glowValue.value * 6;
    return {
      opacity: 0.55 + breathe.value * 0.25 + glowValue.value * 0.2,
      transform: [
        { translateX: blob.x + (breathe.value - 0.5) * drift },
        { translateY: blob.y + (0.5 - breathe.value) * drift },
        { scale: 1 + breathe.value * 0.08 + glowValue.value * 0.06 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.blob,
        { width: blob.size, height: blob.size, borderRadius: blob.size / 2 },
        animatedStyle,
      ]}
    >
      <LinearGradient
        colors={blob.colors as unknown as [string, string]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export default function AuroraGlow({ thinking = false, style }: AuroraGlowProps) {
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.stage, style]}
      testID="ai-aurora-glow"
    >
      <View style={[styles.blobField, { left: width / 2 - 200, top: height / 2 - 260 }]}>
        {BLOBS.map((blob, i) => (
          <AuroraBlob key={i} blob={blob} reduceMotion={reduceMotion} thinking={thinking} />
        ))}
      </View>
      <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
      {/* Vignette keeps the edges true black so the glow reads as centered light, not a colored wash. */}
      <LinearGradient
        colors={['#0A0A0B00', '#0A0A0BE6']}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    backgroundColor: '#0A0A0B',
    overflow: 'hidden',
  },
  blobField: {
    position: 'absolute',
    width: 400,
    height: 520,
  },
  blob: {
    position: 'absolute',
    left: 30,
    top: 100,
  },
});
