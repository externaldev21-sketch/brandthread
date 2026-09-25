/**
 * CanvasGestureLayer.tsx — multi-finger canvas gestures via
 * react-native-gesture-handler + react-native-reanimated:
 *   - two-finger tap  -> undo
 *   - three-finger tap -> redo
 *   - pinch            -> zoom (+ optional rotate) the canvas viewport
 *
 * This wraps its `children` (the actual drawing surface — Skia or SVG) and
 * composes its gestures with `Gesture.Race`/`Gesture.Simultaneous` so it does
 * not swallow single-finger drawing gestures owned by the canvas itself.
 *
 * NOTE: react-native-gesture-handler's tap gesture doesn't have a built-in
 * "N-finger tap" primitive the way native Procreate does, so we approximate
 * it with `numberOfPointers` on a very-short-duration pan gesture (a tap that
 * lifts before any real movement threshold), which is the standard RNGH
 * pattern for multi-finger taps.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';

export interface CanvasViewportState {
  scale: number;
  rotation: number; // degrees
  translateX: number;
  translateY: number;
}

export interface CanvasGestureLayerProps {
  children: React.ReactNode;
  onUndo: () => void;
  onRedo: () => void;
  onViewportChange?: (viewport: CanvasViewportState) => void;
  /** Disable gestures while a drawing tool has an active stroke, to avoid conflicts. */
  enabled?: boolean;
  minScale?: number;
  maxScale?: number;
}

export default function CanvasGestureLayer({
  children, onUndo, onRedo, onViewportChange, enabled = true, minScale = 0.5, maxScale = 6,
}: CanvasGestureLayerProps) {
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedRotation = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  function reportViewport() {
    'worklet';
    if (onViewportChange) {
      runOnJS(onViewportChange)({
        scale: scale.value,
        rotation: rotation.value,
        translateX: translateX.value,
        translateY: translateY.value,
      });
    }
  }

  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .onUpdate((e) => {
      scale.value = Math.max(minScale, Math.min(maxScale, savedScale.value * e.scale));
      reportViewport();
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const rotate = Gesture.Rotation()
    .enabled(enabled)
    .onUpdate((e) => {
      rotation.value = savedRotation.value + (e.rotation * 180) / Math.PI;
      reportViewport();
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
    });

  const pan = Gesture.Pan()
    .enabled(enabled)
    .minPointers(2)
    .maxPointers(2)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
      reportViewport();
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Two-finger tap -> undo. RNGH's TapGesture only exposes `minPointers`
  // (no exact/max pointer count), so we approximate "exactly N fingers" the
  // standard RNGH way: race the 3-finger recognizer ahead of the 2-finger one
  // so a 3-finger tap never also fires as a 2-finger tap.
  const twoFingerTap = Gesture.Tap()
    .enabled(enabled)
    .minPointers(2)
    .maxDuration(250)
    .onEnd((_e: unknown, success: boolean) => {
      if (success) runOnJS(onUndo)();
    });

  // Three-finger tap -> redo
  const threeFingerTap = Gesture.Tap()
    .enabled(enabled)
    .minPointers(3)
    .maxDuration(250)
    .onEnd((_e: unknown, success: boolean) => {
      if (success) runOnJS(onRedo)();
    });

  const doubleTapReset = Gesture.Tap()
    .enabled(enabled)
    .minPointers(1)
    .numberOfTaps(2)
    .onEnd((_e: unknown, success: boolean) => {
      if (!success) return;
      scale.value = withTiming(1);
      rotation.value = withTiming(0);
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedScale.value = 1;
      savedRotation.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    });

  const composed = Gesture.Race(
    threeFingerTap,
    twoFingerTap,
    doubleTapReset,
    Gesture.Simultaneous(pinch, rotate, pan),
  );

  const viewportStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, viewportStyle]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
