/**
 * The Dashboard's range pill row — Today / Week / Month / Year / All with
 * the sliding glass-pill active indicator — extracted verbatim from
 * SellerDashboardChart (which still renders it under the chart, pixel for
 * pixel as before) so other analytics screens can show the SAME control
 * instead of a one-off date-range subtitle. Dev: "Use the SAME range pill
 * row as the Dashboard (Today/Week/Month/Year/All, default Today)."
 */
import React, { useCallback, useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Glass } from '@/components/ui/Glass';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { TAB_INDICATOR_SPRING } from '@/constants/motion';
import { FONT, FS, SP } from '@/lib/theme';

export type SellerDashboardRange = 'today' | 'week' | 'month' | 'year' | 'all';

export const DASHBOARD_RANGES: Array<{ id: SellerDashboardRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All' },
];

export function SellerDashboardRangePills({
  range,
  onRangeChange,
  theme,
  style,
}: {
  range: SellerDashboardRange;
  onRangeChange: (range: SellerDashboardRange) => void;
  theme: AppThemePreset;
  /** Extra style for the row (e.g. a different top margin outside the chart). */
  style?: StyleProp<ViewStyle>;
}) {
  const [rangeRowWidth, setRangeRowWidth] = useState(0);

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
  // The pill only mounts once rangeSegmentWidth is known (below), but that
  // first layout measurement lands well after mount — often seconds, on a
  // screen that waits on real data first. Springing to the initial position
  // from this shared value's x=0 default made the indicator visibly launch
  // from "Today" (index 0) and glide over to whatever range was actually
  // selected the moment it appeared, reading as the period switching itself
  // after load. Only animate real, user-driven range changes; snap directly
  // to the correct spot the first time a width is known.
  const hasPositionedIndicatorRef = React.useRef(false);
  React.useEffect(() => {
    if (rangeSegmentWidth <= 0 || activeRangeIndex < 0) return;
    const x = activeRangeIndex * (rangeSegmentWidth + rangeSegmentGap);
    if (!hasPositionedIndicatorRef.current) {
      hasPositionedIndicatorRef.current = true;
      rangeIndicatorX.value = x;
    } else {
      rangeIndicatorX.value = withSpring(x, TAB_INDICATOR_SPRING);
    }
  }, [activeRangeIndex, rangeSegmentGap, rangeSegmentWidth, rangeIndicatorX]);
  const rangeIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rangeIndicatorX.value }],
    width: rangeSegmentWidth > 0 ? rangeSegmentWidth : 0,
    opacity: rangeSegmentWidth > 0 ? 1 : 0,
  }));

  return (
    <View style={[styles.rangeRow, style]} onLayout={onRangeRowLayout} testID="seller-dashboard-range-pills">
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
            <Text style={[styles.rangeText, { color: selected ? theme.text : theme.muted }]} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  rangeText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
});
