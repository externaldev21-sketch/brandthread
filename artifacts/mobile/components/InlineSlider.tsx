/**
 * A lightweight drag/tap slider with no native dependency — used wherever a
 * screen needs a slider control (budget pickers, discount percentage, etc).
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';

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

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant:          () => { Haptics.selectionAsync(); },
    onPanResponderMove:           (_e, g) => {
      if (steps) {
        const currentIdx = steps.indexOf(value as any);
        const startX = currentIdx === -1
          ? widthRef.current / 2
          : (currentIdx / (steps.length - 1)) * widthRef.current;
        onChange(steps[indexFromX(startX + g.dx)]);
      } else {
        onChange(snapValue(value + (g.dx / widthRef.current) * (max - min)));
      }
    },
  }), [steps, value, max, min, snapValue, indexFromX, onChange]);

  const fraction = fractionFromValue(value);

  return (
    <View
      style={styles.sliderTouch}
      onLayout={(e: LayoutChangeEvent) => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      onTouchEnd={(e) => {
        if (steps) {
          onChange(steps[indexFromX(e.nativeEvent.locationX)]);
        } else {
          onChange(snapValue(min + (e.nativeEvent.locationX / widthRef.current) * (max - min)));
        }
        Haptics.selectionAsync();
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
          if (e.nativeEvent.actionName === 'increment') onChange(steps[Math.min(steps.length - 1, safeI + 1)]);
          else onChange(steps[Math.max(0, safeI - 1)]);
        } else {
          onChange(snapValue(value + (e.nativeEvent.actionName === 'increment' ? step : -step)));
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
  sliderTouch: { height: 44, justifyContent: 'center', position: 'relative' },
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
