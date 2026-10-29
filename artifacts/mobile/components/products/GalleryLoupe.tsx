/**
 * Long-press magnifier loupe for product photos (polish 82).
 *
 * Hold a finger on a photo for a moment and a round loupe appears above the
 * finger showing that spot at 2.5×; slide to move it, lift to dismiss. It
 * sits above the finger so the finger never covers what it magnifies (the
 * iOS text loupe convention, Apple HIG "Loupes").
 *
 * One light haptic when the loupe appears (it tells the buyer the hold
 * worked); none while moving. The photo underneath is drawn the same way the
 * gallery draws it (`contain` in the slide's frame), so the loupe shows the
 * exact pixels under the finger.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { hapticLight } from '@/lib/haptics';

export const LOUPE_SIZE = 128;
export const LOUPE_ZOOM = 2.5;
export const LOUPE_HOLD_MS = 300;
const LOUPE_LIFT = 96; // loupe centre sits this far above the finger
const MOVE_TOLERANCE = 8; // a drag before the hold completes is a swipe, not a hold

export interface LoupePoint { x: number; y: number }

/**
 * Finger position plus the frame's top-left corner, in one coordinate space.
 * Native touch events carry locationX/Y (relative to the photo, which fills
 * the frame); web touch events don't, so there the frame's bounding rect and
 * the touch's viewport position are used instead.
 */
function readTouch(e: GestureResponderEvent): { x: number; y: number; originX: number; originY: number } | null {
  const ne = e.nativeEvent as any;
  const touch = ne.touches?.[0] ?? ne.changedTouches?.[0] ?? ne;
  const rect = (e.currentTarget as any)?.getBoundingClientRect?.();
  if (rect && typeof touch?.clientX === 'number') {
    return { x: touch.clientX, y: touch.clientY, originX: rect.left, originY: rect.top };
  }
  const pageX = typeof ne.pageX === 'number' ? ne.pageX : touch?.pageX;
  const pageY = typeof ne.pageY === 'number' ? ne.pageY : touch?.pageY;
  if (typeof pageX !== 'number' || typeof pageY !== 'number' || typeof ne.locationX !== 'number') return null;
  return { x: pageX, y: pageY, originX: pageX - ne.locationX, originY: pageY - ne.locationY };
}

function touchXY(e: GestureResponderEvent): { x: number; y: number } | null {
  const ne = e.nativeEvent as any;
  const touch = ne.touches?.[0] ?? ne.changedTouches?.[0] ?? ne;
  if ((e.currentTarget as any)?.getBoundingClientRect && typeof touch?.clientX === 'number') return { x: touch.clientX, y: touch.clientY };
  const x = typeof ne.pageX === 'number' ? ne.pageX : touch?.pageX;
  const y = typeof ne.pageY === 'number' ? ne.pageY : touch?.pageY;
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

/** Where the loupe circle goes for a finger at `p` in a `width`×`height` frame. */
export function loupeFrame(p: LoupePoint, width: number, height: number) {
  const r = LOUPE_SIZE / 2;
  const left = Math.min(Math.max(p.x - r, 0), width - LOUPE_SIZE);
  const top = Math.min(Math.max(p.y - LOUPE_LIFT - r, 0), height - LOUPE_SIZE);
  // Offset of the magnified photo inside the circle so `p` is always at its
  // centre, even when the circle is pushed in from an edge.
  const imageLeft = r - p.x * LOUPE_ZOOM;
  const imageTop = r - p.y * LOUPE_ZOOM;
  return { left, top, imageLeft, imageTop };
}

/**
 * Touch handlers for a photo frame. `enabled` is false while the photo is
 * pinch-zoomed. `onActiveChange` lets the gallery stop paging while the
 * loupe is up.
 */
export function useGalleryLoupe({ enabled, onActiveChange }: { enabled: boolean; onActiveChange?: (active: boolean) => void }) {
  const [point, setPoint] = useState<LoupePoint | null>(null);
  const activeRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  // A hold in progress when the photo unmounts must not fire the loupe later.
  useEffect(() => () => clearTimer(), []);

  const end = useCallback(() => {
    clearTimer();
    start.current = null;
    if (activeRef.current) {
      activeRef.current = false;
      setPoint(null);
      onActiveChange?.(false);
    }
  }, [onActiveChange]);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    const t = readTouch(e);
    if (!enabled || !t || (touches && touches.length !== 1)) { end(); return; }
    start.current = t;
    clearTimer();
    timer.current = setTimeout(() => {
      if (!start.current) return;
      activeRef.current = true;
      setPoint({ x: start.current.x - start.current.originX, y: start.current.y - start.current.originY });
      onActiveChange?.(true);
      hapticLight();
    }, LOUPE_HOLD_MS);
  }, [enabled, end, onActiveChange]);

  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    const s = start.current;
    if (!s) return;
    const touches = e.nativeEvent.touches;
    if (touches && touches.length > 1) { end(); return; }
    const p = touchXY(e);
    if (!p) return;
    if (!activeRef.current) {
      if (Math.abs(p.x - s.x) > MOVE_TOLERANCE || Math.abs(p.y - s.y) > MOVE_TOLERANCE) end();
      return;
    }
    setPoint({ x: p.x - s.originX, y: p.y - s.originY });
  }, [end]);

  return {
    point,
    activeRef,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end },
  };
}

export function GalleryLoupe({ uri, point, width, height }: { uri: string; point: LoupePoint; width: number; height: number }) {
  const f = loupeFrame(point, width, height);
  return (
    <View
      pointerEvents="none"
      style={[styles.loupe, { left: f.left, top: f.top }]}
      testID="gallery-loupe"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={{ uri }}
        resizeMode="contain"
        style={{ position: 'absolute', left: f.imageLeft, top: f.imageTop, width: width * LOUPE_ZOOM, height: height * LOUPE_ZOOM }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loupe: {
    position: 'absolute',
    width: LOUPE_SIZE,
    height: LOUPE_SIZE,
    borderRadius: LOUPE_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFFFFF', // theme-exempt: fixed white rim over the photo, like the other media chrome
    backgroundColor: '#000000', // theme-exempt: letterbox behind a contained photo
  },
});
