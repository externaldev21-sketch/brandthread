/**
 * Root-level sibling overlay that lifts a pinching photo above navigation /
 * tab bar WITHOUT a Modal (a Modal would cancel the in-flight native touches).
 * The carousel keeps owning the gesture; it only hands the host its shared
 * transform values, so the lifted copy moves on the UI thread in lockstep.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { CachedImage } from '@/components/CachedImage';

export type ZoomLift = {
  uri: string;
  rect: { x: number; y: number; width: number; height: number };
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  /** Set true once the lifted copy is on screen so the original can hide. */
  lifted: SharedValue<boolean>;
  /** How the copy fills `rect` — match the original (default 'contain'). */
  contentFit?: 'contain' | 'cover';
  /** Corner radius of the original frame, so the lift starts identical. */
  borderRadius?: number;
};

let current: ZoomLift | null = null;
let mounted = 0;
const listeners = new Set<(l: ZoomLift | null) => void>();

export function isZoomHostMounted(): boolean { return mounted > 0; }
export function showZoomLift(lift: ZoomLift): void { current = lift; listeners.forEach((l) => l(lift)); }
export function hideZoomLift(lifted?: SharedValue<boolean>): void {
  if (lifted && current && current.lifted !== lifted) return;
  if (current) current.lifted.value = false;
  current = null;
  listeners.forEach((l) => l(null));
}

function LiftLayer({ lift }: { lift: ZoomLift }) {
  const { scale, tx, ty, lifted } = lift;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', left: lift.rect.x, top: lift.rect.y, width: lift.rect.width, height: lift.rect.height, borderRadius: lift.borderRadius ?? 0, overflow: 'hidden' }, style]}
      testID="photo-zoom-lift"
    >
      {/* The original hides only once this copy has actually painted. */}
      <CachedImage
        source={{ uri: lift.uri }} style={StyleSheet.absoluteFill} contentFit={lift.contentFit ?? 'contain'} transition={0}
        onLoad={() => { lifted.value = true; }}
        onDisplay={() => { lifted.value = true; }}
        testID="photo-zoom-lift-image"
      />
    </Animated.View>
  );
}

export function PhotoZoomHost() {
  const [lift, setLift] = useState<ZoomLift | null>(current);
  useEffect(() => {
    mounted += 1;
    listeners.add(setLift);
    return () => { mounted -= 1; listeners.delete(setLift); };
  }, []);
  if (!lift) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="none" testID="photo-zoom-host">
      <LiftLayer key={lift.uri + lift.rect.x + lift.rect.y} lift={lift} />
    </View>
  );
}

// Above web layers, native stack headers and the tab bar.
const styles = StyleSheet.create({ layer: { zIndex: 9999, elevation: 9999 } });
