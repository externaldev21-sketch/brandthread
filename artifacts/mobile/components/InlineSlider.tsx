/**
 * A lightweight drag/tap slider with no native dependency — used wherever a
 * screen needs a slider control (budget pickers, discount percentage, etc).
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, PanResponder, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { haptics, haptic } from '@/lib/haptics';


export function InlineSlider({
  value, min, max, step = 1, steps, onChange, accessibilityLabel, trackColor = 'rgba(255,255,255,0.10)', accentColor = '#fff',
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  steps?: readonly number[];
  onChange: (v: number) => void;
  accessibilityLabel: string;
  trackColor?: string;
  accentColor?: string;
}) {
  const widthRef = useRef(1);
  // Window x of the track's left edge, for platforms whose touch events carry
  // no locationX (react-native-web): measured when a touch starts.
  const viewRef = useRef<View>(null);
  const leftRef = useRef(0);
  // Never hand the screen a NaN (a bad touch position must not become "NaN days").
  const emit = useCallback((v: number | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v)) onChange(v);
  }, [onChange]);

  const snapValue = useCallback((raw: number): number => {
    if (steps) {
      let best = steps[0];
      let bestDist = Math.abs(raw - best);
      for (const s of steps) {
        const d = Math.abs(raw - s);
        if (d < bestDist) { best = s; bestDist = d; }
      }
      return best;
    }
    const clamped = Math.max(min, Math.min(max, raw));
    return Math.round((clamped - min) / step) * step + min;
  }, [min, max, step, steps]);

  const fractionFromValue = useCallback((v: number): number => {
    if (steps) {
      const idx = steps.indexOf(v as any);
      const safeIdx = idx === -1 ? 0 : idx;
      return safeIdx / (steps.length - 1);
    }
    return (v - min) / (max - min);
  }, [min, max, steps]);

  const indexFromX = useCallback((x: number): number => {
    if (!steps) return -1;
    const fraction = Math.max(0, Math.min(1, x / widthRef.current));
    return Math.min(steps.length - 1, Math.round(fraction * (steps.length - 1)));
  }, [steps]);

  // `g.dx` is the total drag since the touch started, so it is applied to the
  // value the drag started from (captured at grant) — not to the value the
  // drag has already moved to, which would count every pixel again on each
  // move. The responder reads the latest props through a ref so it stays the
  // same instance for the whole gesture.
  const latest = useRef({ value, steps, min, max, snapValue, indexFromX, emit });
  latest.current = { value, steps, min, max, snapValue, indexFromX, emit };
  const dragStartValue = useRef(value);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    // Keep the drag once it starts: a long horizontal drag must never be
    // handed to the screen's swipe-back gesture (or a parent scroll view).
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant:          () => { dragStartValue.current = latest.current.value; },
    onPanResponderMove:           (_e, g) => {
      const { steps: s, min: lo, max: hi, snapValue: snap, indexFromX: toIndex, emit: send } = latest.current;
      const start = dragStartValue.current;
      if (s) {
        const currentIdx = s.indexOf(start as any);
        const startX = currentIdx === -1
          ? widthRef.current / 2
          : (currentIdx / (s.length - 1)) * widthRef.current;
        send(s[toIndex(startX + g.dx)]);
      } else {
        send(snap(start + (g.dx / widthRef.current) * (hi - lo)));
      }
    },
  }), []);

  const fraction = fractionFromValue(value);

  return (
    <View
      ref={viewRef}
      style={styles.sliderTouch}
      onLayout={(e: LayoutChangeEvent) => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      onTouchStart={() => { viewRef.current?.measureInWindow?.((x) => { if (Number.isFinite(x)) leftRef.current = x; }); }}
      onTouchEnd={(e) => {
        const ne = e.nativeEvent as typeof e.nativeEvent & { changedTouches?: ArrayLike<{ pageX: number }> };
        const pageX = Number.isFinite(ne.pageX) ? ne.pageX : ne.changedTouches?.[0]?.pageX;
        const x = Number.isFinite(ne.locationX) ? ne.locationX : (pageX ?? NaN) - leftRef.current;
        if (!Number.isFinite(x)) return;
        if (steps) {
          emit(steps[indexFromX(x)]);
        } else {
          emit(snapValue(min + (x / widthRef.current) * (max - min)));
        }
        haptic('select');
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (steps) {
          const idx = steps.indexOf(value as any);
          const safeI = idx === -1 ? 0 : idx;
          if (e.nativeEvent.actionName === 'increment') emit(steps[Math.min(steps.length - 1, safeI + 1)]);
          else emit(steps[Math.max(0, safeI - 1)]);
        } else {
          emit(snapValue(value + (e.nativeEvent.actionName === 'increment' ? step : -step)));
        }
      }}
      {...panResponder.panHandlers}
    >
      <View style={[styles.sliderTrack, { backgroundColor: trackColor }]}>
        <View style={[styles.sliderFill, { width: `${fraction * 100}%` as any, backgroundColor: accentColor }]} />
      </View>
      <View style={[styles.sliderThumb, { left: `${fraction * 100}%` as any, borderColor: accentColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // touch-action none (web): the browser must not treat a drag along the
  // slider as a page pan or a swipe-back through history.
  sliderTouch: { height: 44, justifyContent: 'center', position: 'relative', touchAction: 'none' } as ViewStyle,
  sliderTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  sliderFill:  { height: 5, borderRadius: 3 },
  sliderThumb: {
    position: 'absolute', top: 10, width: 24, height: 24, borderRadius: 12,
    marginLeft: -12, backgroundColor: '#fff',
    borderWidth: 3,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
