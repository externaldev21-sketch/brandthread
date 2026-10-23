/**
 * Shared spotlight presentation for first-run tips: a 60% black dim with a
 * real, rounded hole over a measured target. Web touches reach the real
 * control underneath; native uses the approved completion-only fallback.
 *
 * The dim is four bands around the hole (tap = dismiss) plus four small
 * corner pieces that round the hole's inner corners. Corner pieces are
 * pointerEvents="none" so their few pixels fall through to the target too.
 *
 * Completion: on web, a capture-phase, passive document listener observes a
 * press inside the hole (without stopping or altering it) and calls
 * `onTargetPress` on the next tick, after the target's own handler ran.
 * Native cannot safely replay a touch to a measurement-only ref: the ref
 * exposes geometry, not the control's action. A transparent Pressable inside
 * the hole therefore completes the tip WITHOUT activating the real control.
 * The user can tap the control normally after the tip closes.
 */
import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { TargetRect } from './types';

export const SPOTLIGHT_HOLE_PADDING = 10;
export const SPOTLIGHT_HOLE_RADIUS = 14;
export const SPOTLIGHT_DIM = 'rgba(0,0,0,0.6)'; // theme-exempt: neutral spotlight scrim

export function holeFor(target: TargetRect, screenW: number, screenH: number): TargetRect {
  const x = Math.max(target.x - SPOTLIGHT_HOLE_PADDING, 0);
  const y = Math.max(target.y - SPOTLIGHT_HOLE_PADDING, 0);
  const right = Math.min(target.x + target.width + SPOTLIGHT_HOLE_PADDING, screenW);
  const bottom = Math.min(target.y + target.height + SPOTLIGHT_HOLE_PADDING, screenH);
  return { x, y, width: Math.max(right - x, 0), height: Math.max(bottom - y, 0) };
}

export interface SpotlightOverlayProps {
  hole: TargetRect;
  onScrimPress: () => void;
  onTargetPress?: () => void;
  scrimLabel?: string;
}

function Corner({ x, y, corner, r }: { x: number; y: number; corner: 'tl' | 'tr' | 'bl' | 'br'; r: number }) {
  const B = r * 2; // ring thickness, large enough to fill the r×r box
  const size = (r + B) * 2;
  const inner = {
    position: 'absolute' as const,
    width: size, height: size,
    borderWidth: B, borderRadius: r + B, borderColor: SPOTLIGHT_DIM,
    left: 0,
    top: 0,
  };
  // Inner rounded edge must start at the hole corner: for left corners the
  // ring's inner-left edge sits at x=0 (left:-B); for right corners its
  // inner-right edge sits at x=r (left: r - size + B). Same for top/bottom.
  inner.left = corner === 'tl' || corner === 'bl' ? -B : r - size + B;
  inner.top = corner === 'tl' || corner === 'tr' ? -B : r - size + B;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: r, height: r, overflow: 'hidden' }}>
      <View style={inner} />
    </View>
  );
}

export function SpotlightOverlay({ hole, onScrimPress, onTargetPress, scrimLabel = 'Dismiss tip' }: SpotlightOverlayProps) {
  const onTargetRef = useRef(onTargetPress);
  onTargetRef.current = onTargetPress;
  const { x, y, width, height } = hole;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: PointerEvent | MouseEvent) => {
      const px = e.clientX, py = e.clientY;
      if (px >= x && px <= x + width && py >= y && py <= y + height && onTargetRef.current) {
        timer = setTimeout(() => onTargetRef.current?.(), 0);
      }
    };
    document.addEventListener('click', handler, { capture: true, passive: true });
    return () => {
      document.removeEventListener('click', handler, { capture: true } as EventListenerOptions);
      if (timer) clearTimeout(timer);
    };
  }, [x, y, width, height]);

  const r = Math.min(SPOTLIGHT_HOLE_RADIUS, width / 2, height / 2);
  const band = (style: object, key: string) => (
    <Pressable
      key={key}
      testID={`spotlight-scrim-${key}`}
      onPress={onScrimPress}
      accessibilityRole="button"
      accessibilityLabel={scrimLabel}
      style={[styles.band, style]}
    />
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="spotlight-overlay">
      {band({ top: 0, left: 0, right: 0, height: y }, 'top')}
      {band({ top: y + height, left: 0, right: 0, bottom: 0 }, 'bottom')}
      {band({ top: y, height, left: 0, width: x }, 'left')}
      {band({ top: y, height, left: x + width, right: 0 }, 'right')}
      {r > 0 ? (
        <>
          <Corner corner="tl" r={r} x={x} y={y} />
          <Corner corner="tr" r={r} x={x + width - r} y={y} />
          <Corner corner="bl" r={r} x={x} y={y + height - r} />
          <Corner corner="br" r={r} x={x + width - r} y={y + height - r} />
        </>
      ) : null}
      {Platform.OS !== 'web' && onTargetPress ? (
        <Pressable
          testID="spotlight-target-complete"
          accessibilityRole="button"
          accessibilityLabel="Continue tip"
          onPress={() => onTargetRef.current?.()}
          style={[styles.target, { left: x, top: y, width, height, borderRadius: r }]}
        />
      ) : null}
      <View
        pointerEvents="none"
        testID="spotlight-hole"
        style={[styles.ring, { left: x, top: y, width, height, borderRadius: r }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', backgroundColor: SPOTLIGHT_DIM },
  target: { position: 'absolute', backgroundColor: 'transparent' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' }, // theme-exempt: neutral spotlight ring
});
