/**
 * Chart scrubbing for the analytics report charts (micro-interactions pack 2,
 * item 17) — the same press-and-drag model the Dashboard's
 * SellerDashboardChart already uses, lifted into a reusable hook + overlay so
 * InsightLineChart and AnalyticsBarChart scrub identically.
 *
 * Mobbin reference: Robinhood / Coinbase / Apple Stocks price charts — touch
 * the plot and a hairline + value lens follows the finger, snapping its value
 * to the nearest bucket, with a selection tick each time the bucket changes.
 *
 * The lens itself tracks the finger on the UI thread (a shared value), only
 * the value text goes through React (once per bucket change, not per frame).
 * Horizontal-intent only: a vertical drag fails the pan so the report's
 * ScrollView still scrolls.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { useColors } from '@/hooks/useColors';
import { haptic } from '@/lib/haptics';
import { FONT } from '@/lib/theme';

export const SCRUB_LENS_WIDTH = 96;

export interface ChartScrubGeometry {
  /** Number of buckets. */
  count: number;
  /** Plot's left edge (after the y-axis gutter) in the chart's own coords. */
  plotLeft: number;
  /** Plot width. */
  plotWidth: number;
  /** Bucket index → x of that bucket's centre (line point / bar centre). */
  xForIndex: (index: number) => number;
}

/** Nearest bucket for a finger x. Pure + worklet-safe; exported for tests. */
export function scrubIndexForX(x: number, count: number, plotLeft: number, plotWidth: number, centred: boolean): number {
  'worklet';
  if (count <= 0 || plotWidth <= 0) return -1;
  const rel = Math.max(0, Math.min(plotWidth, x - plotLeft));
  const raw = centred
    ? Math.floor((rel / plotWidth) * count)
    : count > 1 ? Math.round((rel / plotWidth) * (count - 1)) : 0;
  return Math.max(0, Math.min(count - 1, raw));
}

/**
 * `centred` is for bar charts (each bucket owns an equal-width slot);
 * line charts put bucket i exactly at i/(n-1) of the plot.
 */
export function useChartScrub({ count, plotLeft, plotWidth, centred = false, enabled = true }: {
  count: number; plotLeft: number; plotWidth: number; centred?: boolean; enabled?: boolean;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const fingerX = useSharedValue(0);
  const active = useSharedValue(0);
  const activeIndex = useSharedValue(-1);

  const lastIndex = React.useRef<number | null>(null);
  const onIndex = useCallback((i: number) => {
    // A selection tick per bucket crossed — not on the first touch.
    if (lastIndex.current !== null && lastIndex.current !== i) haptic('select');
    lastIndex.current = i;
    setIndex(i);
  }, []);
  const onEnd = useCallback(() => { lastIndex.current = null; setIndex(null); }, []);

  const update = useCallback((x: number) => {
    'worklet';
    fingerX.value = Math.max(plotLeft, Math.min(plotLeft + plotWidth, x));
    activeIndex.value = scrubIndexForX(x, count, plotLeft, plotWidth, centred);
  }, [activeIndex, centred, count, fingerX, plotLeft, plotWidth]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled && count > 0 && plotWidth > 0)
    // Horizontal intent: start scrubbing after a small sideways move, and
    // hand a vertical drag back to the screen's ScrollView.
    .activeOffsetX([-4, 4])
    .failOffsetY([-14, 14])
    .onStart((e) => {
      'worklet';
      update(e.x);
      active.value = withTiming(1, { duration: 90 });
    })
    .onUpdate((e) => {
      'worklet';
      update(e.x);
    })
    .onFinalize(() => {
      'worklet';
      active.value = withTiming(0, { duration: 140 });
      activeIndex.value = -1;
      runOnJS(onEnd)();
    }), [active, activeIndex, count, enabled, onEnd, plotWidth, update]);

  useAnimatedReaction(
    () => activeIndex.value,
    (cur, prev) => { if (cur !== prev && cur >= 0) runOnJS(onIndex)(cur); },
    [onIndex],
  );

  return { gesture, index, fingerX, active };
}

/** Hairline + value lens that follows the finger across the plot. */
export function ChartScrubLens({ fingerX, active, chartWidth, plotTop, plotHeight, value, label, dotY }: {
  fingerX: ReturnType<typeof useSharedValue<number>>;
  active: ReturnType<typeof useSharedValue<number>>;
  chartWidth: number;
  plotTop: number;
  plotHeight: number;
  value: string | null;
  label?: string | null;
  /** y of the scrubbed point (line charts) — omitted for bars. */
  dotY?: number | null;
}) {
  const colors = useColors();
  const lineStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ translateX: fingerX.value - 0.5 }],
  }));
  const lensStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [
      { translateX: Math.max(0, Math.min(chartWidth - SCRUB_LENS_WIDTH, fingerX.value - SCRUB_LENS_WIDTH / 2)) },
      { scale: 0.92 + 0.08 * active.value },
    ],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ translateX: fingerX.value - 4 }],
  }));
  return (
    <>
      <Animated.View
        pointerEvents="none"
        testID="chart-scrub-line"
        style={[styles.line, { top: plotTop, height: plotHeight, backgroundColor: colors.mutedForeground }, lineStyle]}
      />
      {dotY != null && (
        <Animated.View
          pointerEvents="none"
          style={[styles.dot, { top: dotY - 4, backgroundColor: colors.foreground, borderColor: colors.background }, dotStyle]}
        />
      )}
      <Animated.View
        pointerEvents="none"
        testID="chart-scrub-lens"
        style={[styles.lens, { backgroundColor: colors.foreground }, lensStyle]}
      >
        <Text style={[styles.value, { color: colors.background }]} numberOfLines={1}>{value ?? ''}</Text>
        {label ? <Text style={[styles.label, { color: colors.background }]} numberOfLines={1}>{label}</Text> : null}
      </Animated.View>
    </>
  );
}

/** Wraps a chart's root view in the scrub gesture. */
export function ChartScrubArea({ gesture, children, accessibilityLabel }: {
  gesture: ReturnType<typeof useChartScrub>['gesture'];
  children: React.ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <GestureDetector gesture={gesture}>
      <View accessibilityLabel={accessibilityLabel} collapsable={false}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, width: 1 },
  dot: { position: 'absolute', left: 0, width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  lens: {
    position: 'absolute', top: -6, left: 0, width: SCRUB_LENS_WIDTH, minHeight: 36,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  value: { fontFamily: FONT.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
  label: { fontFamily: FONT.medium, fontSize: 11 },
});
