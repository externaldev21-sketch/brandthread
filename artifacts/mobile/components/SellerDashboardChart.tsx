import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { layoutSeriesPoints, smoothPath } from '@/lib/svgSmoothPath';
import { BORDER_SUBTLE, FONT, FS, SP } from '@/lib/theme';

export type SellerDashboardRange = 'today' | 'week' | 'month' | 'year' | 'all';

export const DASHBOARD_RANGES: Array<{ id: SellerDashboardRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All' },
];

const CHART_HEIGHT = 168;

export function SellerDashboardChart({
  values,
  labels,
  theme,
  range,
  onRangeChange,
  onScrub,
  isEmpty,
}: {
  values: number[];
  labels: string[];
  theme: AppThemePreset;
  range: SellerDashboardRange;
  onRangeChange: (range: SellerDashboardRange) => void;
  /** Called with the scrubbed bucket index, or null when the finger lifts. */
  onScrub: (index: number | null) => void;
  isEmpty: boolean;
}) {
  const [width, setWidth] = useState(0);
  const lastHapticIndex = React.useRef<number | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  // A flat baseline for the empty/new-seller state — never fabricate activity.
  const series = isEmpty || values.length === 0 ? values.map(() => 0) : values;
  const points = useMemo(() => layoutSeriesPoints(series, Math.max(width, 1), CHART_HEIGHT), [series, width]);
  const linePath = useMemo(() => smoothPath(points), [points]);
  const areaPath = useMemo(() => {
    if (points.length < 2) return '';
    const last = points[points.length - 1];
    const first = points[0];
    return `${linePath} L${last.x},${CHART_HEIGHT} L${first.x},${CHART_HEIGHT} Z`;
  }, [linePath, points]);

  const scrubX = useSharedValue(0);
  const scrubActive = useSharedValue(0);
  const activeIndex = useSharedValue(-1);

  const handleIndexChange = useCallback((index: number) => {
    if (lastHapticIndex.current !== index) {
      lastHapticIndex.current = index;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onScrub(index);
  }, [onScrub]);

  const handleScrubEnd = useCallback(() => {
    lastHapticIndex.current = null;
    onScrub(null);
  }, [onScrub]);

  const clampAndSetIndex = useCallback((x: number) => {
    'worklet';
    if (points.length === 0 || width <= 0) return;
    scrubX.value = Math.max(0, Math.min(width, x));
    const stepX = points.length > 1 ? width / (points.length - 1) : width;
    const rawIndex = stepX > 0 ? Math.round(scrubX.value / stepX) : 0;
    activeIndex.value = Math.max(0, Math.min(points.length - 1, rawIndex));
  }, [points.length, width, scrubX, activeIndex]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(series.length > 1 && !isEmpty)
        .onBegin((event) => {
          'worklet';
          scrubActive.value = 1;
          clampAndSetIndex(event.x);
        })
        .onUpdate((event) => {
          'worklet';
          clampAndSetIndex(event.x);
        })
        .onFinalize(() => {
          'worklet';
          scrubActive.value = 0;
          runOnJS(handleScrubEnd)();
        }),
    [clampAndSetIndex, handleScrubEnd, isEmpty, points.length, scrubActive],
  );

  useAnimatedReaction(
    () => (scrubActive.value ? activeIndex.value : -1),
    (current, previous) => {
      if (current !== previous && current >= 0) {
        runOnJS(handleIndexChange)(current);
      }
    },
    [handleIndexChange],
  );

  const cursorStyle = useAnimatedStyle(() => ({
    opacity: scrubActive.value,
    transform: [{ translateX: scrubX.value - 0.5 }],
  }));
  const dotStyle = useAnimatedStyle(() => {
    const point = points[Math.max(0, Math.min(points.length - 1, activeIndex.value))];
    return {
      opacity: scrubActive.value,
      transform: [
        { translateX: (point?.x ?? 0) - 4 },
        { translateY: (point?.y ?? CHART_HEIGHT / 2) - 4 },
      ],
    };
  });

  const gradientId = 'sellerDashboardChartFill';
  const strokeColor = isEmpty ? (theme as any).borderSubtle ?? BORDER_SUBTLE : theme.accent;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          testID="seller-dashboard-chart"
          accessibilityLabel="Sales activity chart, scrub with your finger to inspect a point"
          onLayout={onLayout}
          style={styles.chartArea}
        >
          {width > 0 && points.length > 0 && (
            <Svg width={width} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={strokeColor} stopOpacity={isEmpty ? 0.08 : 0.32} />
                  <Stop offset="1" stopColor={strokeColor} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {areaPath ? <Path d={areaPath} fill={`url(#${gradientId})`} stroke="none" /> : null}
              {linePath ? (
                <Path
                  d={linePath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isEmpty ? 1.5 : 2.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
            </Svg>
          )}
          {!isEmpty && (
            <>
              <Animated.View pointerEvents="none" style={[styles.cursorLine, { backgroundColor: theme.border }, cursorStyle]} />
              <Animated.View pointerEvents="none" style={[styles.cursorDot, { backgroundColor: theme.accent, borderColor: theme.background }, dotStyle]} />
            </>
          )}
        </View>
      </GestureDetector>

      <View style={styles.rangeRow} testID="seller-dashboard-range-pills">
        {DASHBOARD_RANGES.map((item) => {
          const selected = item.id === range;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => onRangeChange(item.id)}
              activeOpacity={0.75}
              style={[
                styles.rangePill,
                selected && { backgroundColor: theme.accentDim },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.label}`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.rangeText, { color: selected ? theme.text : theme.muted }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {labels.length > 0 && !isEmpty && (
        <View style={styles.axisRow} pointerEvents="none">
          <Text style={[styles.axisLabel, { color: theme.subtle }]}>{labels[0]}</Text>
          <Text style={[styles.axisLabel, { color: theme.subtle }]}>{labels[labels.length - 1]}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartArea: {
    height: CHART_HEIGHT,
    width: '100%',
  },
  cursorLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  cursorDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: SP.xs,
    marginTop: SP.sm,
  },
  rangePill: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  rangeText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SP.xs,
  },
  axisLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
  },
});
