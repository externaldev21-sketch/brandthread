/**
 * Renders a clone of the tapped grid tile's image, animating from its exact
 * on-screen rect (captured by the grid just before navigating — see
 * lib/tileTransition.ts) into the destination rect on the full-screen
 * viewer, then fades out to reveal the real content underneath. A
 * lightweight, dependency-free stand-in for a true native shared-element
 * transition — Reanimated's shared-element API needs per-platform native
 * config this repo doesn't have wired up yet, and doesn't run on web at
 * all, where this app also renders.
 *
 * No-ops (renders nothing) when there's no pending transition for this
 * post — a direct deep link or "back" navigation always just shows the
 * screen immediately, exactly as before this existed.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { takePendingTileTransition } from '@/lib/tileTransition';

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useExpandFromTileOverlay(postId: string | undefined, destination: TileRect) {
  const [transition] = useState(() => (postId ? takePendingTileTransition(postId) : null));
  const progress = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(!transition);

  useEffect(() => {
    if (!transition) return;
    const anim = Animated.timing(progress, { toValue: 1, duration: 320, useNativeDriver: true });
    anim.start(() => setDone(true));
    return () => anim.stop();
  }, [transition, progress]);

  const overlay = transition && !done ? (
    <ExpandFromTileOverlay uri={transition.uri} origin={transition.rect} destination={destination} progress={progress} />
  ) : null;

  return { overlay, contentOpacity: transition ? progress : undefined };
}

function ExpandFromTileOverlay({
  uri, origin, destination, progress,
}: {
  uri: string | null;
  origin: TileRect;
  destination: TileRect;
  progress: Animated.Value;
}) {
  if (!uri) return null;

  // Laid out at the destination's final position/size (so it lines up
  // pixel-perfect with the real content once the animation ends), then
  // scaled/translated from there down to the origin tile at progress=0.
  // RN transforms are native-driver compatible; animating width/height
  // directly is not, so the "grow" effect comes entirely from scale
  // (anchored at each view's own center, hence the translate compensation
  // to land the origin tile's center in the right place).
  const originCenterX = origin.x + origin.width / 2;
  const originCenterY = origin.y + origin.height / 2;
  const destCenterX = destination.x + destination.width / 2;
  const destCenterY = destination.y + destination.height / 2;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [originCenterX - destCenterX, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [originCenterY - destCenterY, 0] });
  const scaleX = progress.interpolate({ inputRange: [0, 1], outputRange: [destination.width > 0 ? origin.width / destination.width : 1, 1] });
  const scaleY = progress.interpolate({ inputRange: [0, 1], outputRange: [destination.height > 0 ? origin.height / destination.height : 1, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.overlay,
        {
          left: destination.x,
          top: destination.y,
          width: destination.width,
          height: destination.height,
          opacity,
          transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }],
        },
      ]}
    >
      <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    zIndex: 50,
    overflow: 'hidden',
  },
});
