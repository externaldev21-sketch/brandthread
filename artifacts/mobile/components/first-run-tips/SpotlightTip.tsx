/**
 * `spotlight` variant — dims everything except one specific, real measured
 * control, with a caption and an arrow pointing at it. Reskin of the Rodeo
 * (https://mobbin.com/screens/4ea8f1c8-031b-4566-9e95-d80e0a1b21f6) and Grab
 * (https://mobbin.com/screens/df570cd4-740b-4473-9e09-bd79ec94d59f)
 * references cited in the PR, in this app's monochrome.
 *
 * The "hole" is built from four dim rectangles around the target rect
 * (top/bottom/left/right bands) rather than a mask/SVG cutout — simpler and
 * fully supported on web (this app's Playwright verification target) with
 * no extra dependency.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS, TEXT_SECONDARY, TEXT_TERTIARY } from '@/lib/theme';
import type { TargetRect } from './types';

export interface SpotlightTipProps {
  visible: boolean;
  onDismiss: () => void;
  /** The real, measured rect of the control being highlighted. Null before it's measured — renders nothing until then. */
  target: TargetRect | null;
  title: string;
  body?: string;
  reduceMotion?: boolean;
  testID?: string;
}

const HOLE_PADDING = 10;
const DIM_COLOR = 'rgba(0,0,0,0.72)';

export function SpotlightTip({ visible, onDismiss, target, title, body, reduceMotion = false, testID }: SpotlightTipProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: visible && target ? 1 : 0, duration: reduceMotion ? 1 : 220, useNativeDriver: true }).start();
  }, [visible, target, fade, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || !visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, visible]);

  if (!visible || !target) return null;

  const hole = {
    x: Math.max(target.x - HOLE_PADDING, 0),
    y: Math.max(target.y - HOLE_PADDING, 0),
    width: target.width + HOLE_PADDING * 2,
    height: target.height + HOLE_PADDING * 2,
  };
  const holeRight = hole.x + hole.width;
  const holeBottom = hole.y + hole.height;
  // Caption goes below the hole if there's room, otherwise above it.
  const captionBelow = holeBottom + 140 < screenH;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
      testID={testID ?? 'first-run-tip-spotlight'}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityRole="button" accessibilityLabel={`${title}. Tap to dismiss.`}>
        {/* Four dim bands around the hole */}
        <View style={[styles.dim, { top: 0, left: 0, right: 0, height: hole.y, backgroundColor: DIM_COLOR }]} />
        <View style={[styles.dim, { top: holeBottom, left: 0, right: 0, bottom: 0, backgroundColor: DIM_COLOR }]} />
        <View style={[styles.dim, { top: hole.y, height: hole.height, left: 0, width: hole.x, backgroundColor: DIM_COLOR }]} />
        <View style={[styles.dim, { top: hole.y, height: hole.height, left: holeRight, right: 0, backgroundColor: DIM_COLOR }]} />
        {/* Ring around the highlighted control */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            { left: hole.x, top: hole.y, width: hole.width, height: hole.height },
            reduceMotion ? null : { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
          ]}
        />

        <View
          pointerEvents="none"
          style={[
            styles.captionWrap,
            captionBelow
              ? { top: holeBottom + SP.md }
              : { bottom: screenH - hole.y + SP.md },
          ]}
        >
          <Feather name={captionBelow ? 'arrow-up' : 'arrow-down'} size={18} color="#FFFFFF" style={styles.arrow} />
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <Text style={styles.dismissHint}>Tap anywhere to continue</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  ring: { position: 'absolute', borderRadius: RADIUS.lg, borderWidth: 2, borderColor: '#FFFFFF' },
  captionWrap: { position: 'absolute', left: SP.xl, right: SP.xl, alignItems: 'center' },
  arrow: { marginBottom: 6 },
  title: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  body: { color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: 4 },
  dismissHint: { color: TEXT_TERTIARY, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 14, letterSpacing: 0.3 },
});
