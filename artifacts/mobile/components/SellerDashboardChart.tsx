import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Glass } from '@/components/ui/Glass';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { TAB_INDICATOR_SPRING } from '@/constants/motion';
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
  formatValue,
}: {
  values: number[];
  labels: string[];
  theme: AppThemePreset;
  range: SellerDashboardRange;
  onRangeChange: (range: SellerDashboardRange) => void;
  /** Called with the scrubbed bucket index, or null when the finger lifts. */
  onScrub: (index: number | null) => void;
  isEmpty: boolean;
  /** Formats a raw bucket value for the in-chart scrub tooltip (defaults to a plain string). */
  formatValue?: (value: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const [rangeRowWidth, setRangeRowWidth] = useState(0);
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const lastHapticIndex = React.useRef<number | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  const onRangeRowLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setRangeRowWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  // Sliding glass-pill active-range indicator: one equal-width segment per
  // range tab (gap already subtracted so the pill lands exactly on a tab).
  const rangeSegmentGap = SP.xs;
  const rangeSegmentWidth = rangeRowWidth > 0
    ? (rangeRowWidth - rangeSegmentGap * (DASHBOARD_RANGES.length - 1)) / DASHBOARD_RANGES.length
    : 0;
  const activeRangeIndex = DASHBOARD_RANGES.findIndex((item) => item.id === range);
  const rangeIndicatorX = useSharedValue(0);
  React.useEffect(() => {
    if (rangeSegmentWidth <= 0 || activeRangeIndex < 0) return;
    rangeIndicatorX.value = withSpring(
      activeRangeIndex * (rangeSegmentWidth + rangeSegmentGap),
      TAB_INDICATOR_SPRING,
    );
  }, [activeRangeIndex, rangeSegmentGap, rangeSegmentWidth, rangeIndicatorX]);
  const rangeIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rangeIndicatorX.value }],
    width: rangeSegmentWidth > 0 ? rangeSegmentWidth : 0,
    opacity: rangeSegmentWidth > 0 ? 1 : 0,
  }));

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
    setTooltipIndex(index);
    onScrub(index);
  }, [onScrub]);

  const handleScrubEnd = useCallback(() => {
    lastHapticIndex.current = null;
    setTooltipIndex(null);
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
          {!isEmpty && tooltipIndex !== null && points[tooltipIndex] && (
            <View
              pointerEvents="none"
              testID="seller-dashboard-chart-tooltip"
              style={[
                styles.tooltip,
                {
                  left: Math.max(4, Math.min(width - 4, points[tooltipIndex].x)),
                  top: Math.max(0, points[tooltipIndex].y - 34),
                },
              ]}
            >
              <Glass variant="regular" radius={10} style={StyleSheet.absoluteFill} />
              <Text style={[styles.tooltipText, { color: theme.text }]} numberOfLines={1}>
                {(formatValue ?? String)(values[tooltipIndex] ?? 0)}
              </Text>
            </View>
          )}
        </View>
      </GestureDetector>

      <View style={styles.rangeRow} onLayout={onRangeRowLayout} testID="seller-dashboard-range-pills">
        {rangeSegmentWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.rangeIndicatorWrap, rangeIndicatorStyle]}
            testID="seller-dashboard-range-indicator"
          >
            <Glass variant="pressed" radius={999} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
        {DASHBOARD_RANGES.map((item) => {
          const selected = item.id === range;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => onRangeChange(item.id)}
              activeOpacity={0.75}
              style={styles.rangePill}
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
        <View style={styles.axisRow} pointerEvents="none" testID="seller-dashboard-chart-axis">
          {labels.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              style={[
                styles.axisLabel,
                { color: theme.subtle },
                index === 0 && styles.axisLabelFirst,
                index === labels.length - 1 && styles.axisLabelLast,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          ))}
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
  tooltip: {
    position: 'absolute',
    minWidth: 64,
    paddingHorizontal: SP.sm,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -32 }],
  },
  tooltipText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    fontVariant: ['tabular-nums'],
  },
  rangeRow: {
    flexDirection: 'row',
    gap: SP.xs,
    marginTop: SP.sm,
    position: 'relative',
  },
  rangeIndicatorWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    overflow: 'hidden',
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
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 9,
    textAlign: 'center',
  },
  axisLabelFirst: {
    textAlign: 'left',
  },
  axisLabelLast: {
    textAlign: 'right',
  },
});
