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
import { selectEvenlySpacedIndices } from '@/lib/sellerHomeChartLabels';
import { BORDER_SUBTLE, FONT, FS, SP } from '@/lib/theme';
import { radius } from '@/constants/radii';

export type SellerDashboardRange = 'today' | 'week' | 'month' | 'year' | 'all';

export const DASHBOARD_RANGES: Array<{ id: SellerDashboardRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All' },
];

const CHART_HEIGHT = 168;

// Each visible axis label is positioned absolutely at its bucket's own x
// (see the axisRow render below), in a fixed-width box centered on that
// point — not squeezed into an equal flex column shared with every hidden
// bucket, which was truncating "12 AM"/"6 PM"-style text down to a couple
// of characters once the visible count was much smaller than the bucket
// count (e.g. 4 visible of 24 hourly buckets for Today).
export const AXIS_LABEL_WIDTH = 44;

// How many x-axis labels to actually show text for, per range — a handful
// of evenly-spaced, non-overlapping labels (Shopify's own Sales Report/
// Analytics charts do the same) rather than one per bucket, which for
// Month's ~30 daily buckets or Today's 24 hourly buckets would overlap into
// illegible smears. Every bucket still lays out and is scrubbable — only
// which indices get *visible* label text changes. Week is a deliberate
// exception: a calendar week only ever has 7 buckets, and showing all 7
// ("Mon" through "Sun") is both natural and still non-overlapping at phone
// width.
const AXIS_LABEL_COUNT: Record<SellerDashboardRange, number> = {
  today: 4, week: 7, month: 5, year: 6, all: 6,
};

// Evenly spaced horizontal gridlines drawn behind the empty state — a
// genuinely-zero chart (a fresh store) reads as an intentional, correctly
// laid-out chart with no data yet, not as a rendering glitch.
const EMPTY_GRIDLINE_COUNT = 3;

export function SellerDashboardChart({
  values,
  labels,
  theme,
  range,
  onRangeChange,
  onScrub,
  isEmpty,
  formatValue,
  emptyMessage,
  showNowMarker,
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
  /** Range-aware copy for the empty/fresh-store state (e.g. "No sales yet today"). Defaults to "No sales yet". */
  emptyMessage?: string;
  /** Today only: draws a static "Now" marker at the last (current-hour) point instead of a fabricated point further along the day. */
  showNowMarker?: boolean;
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

  // Empty/new-seller state: no curve at all (not even a flat one) — a
  // drawn-but-flat line at $0 read as a broken/glitched chart. The empty
  // state instead renders real gridlines + a baseline + a centered message
  // below, so it's unambiguous that this is an intentional "no data yet"
  // chart rather than a rendering failure.
  const series = isEmpty ? [] : values;
  const points = useMemo(
    () => (series.length > 0 ? layoutSeriesPoints(series, Math.max(width, 1), CHART_HEIGHT) : []),
    [series, width],
  );
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
  // The empty/fresh-seller state must still draw a real, VISIBLE flat line
  // at $0 (never blank space that reads as a broken/missing chart) — just
  // muted rather than the full accent color, so it never implies real
  // activity. theme.borderSubtle (~4% opacity) was invisible against the
  // dark background; theme.muted is the same solid, monochrome tone the
  // rest of the dashboard already uses for secondary/inactive content.
  const strokeColor = isEmpty ? theme.muted ?? BORDER_SUBTLE : theme.accent;

  // Today's chart spreads its labels across even quarters of the day
  // (12am/6am/12pm/6pm, per Shopify's own Analytics "Yesterday"/"Today"
  // chart) rather than anchoring to the first/last bucket; every other
  // range anchors its evenly-spaced marks to the first and last bucket.
  const wantAxisLabels = AXIS_LABEL_COUNT[range] ?? 5;
  const anchorAxisEnds = range !== 'today';
  // Which real buckets get a label (their timestamps/text) — an ordered
  // list, not a Set, because the *rendered* column position below is
  // derived from each label's position WITHIN this list (evenly spaced by
  // construction), not from its original bucket index. Splitting an uneven
  // bucket count across `want` labels can't always land on perfectly
  // even *index* gaps (e.g. 12 buckets / 6 labels rounds to gaps of
  // 2,2,3,2,2 — one inevitably-larger integer gap), but the labels
  // themselves must still render in perfectly even *pixel* columns, or
  // that integer rounding shows up as a visibly uneven gap on screen.
  const visibleAxisIndices = useMemo(
    () => selectEvenlySpacedIndices(labels.length, wantAxisLabels, anchorAxisEnds),
    [labels.length, wantAxisLabels, anchorAxisEnds],
  );

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
          {isEmpty && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="seller-dashboard-chart-empty">
              {Array.from({ length: EMPTY_GRIDLINE_COUNT }, (_, i) => (
                <View
                  key={`gridline-${i}`}
                  style={[
                    styles.emptyGridline,
                    { top: ((i + 1) * CHART_HEIGHT) / (EMPTY_GRIDLINE_COUNT + 1), backgroundColor: theme.borderSubtle },
                  ]}
                />
              ))}
              <View style={[styles.emptyBaseline, { backgroundColor: theme.border }]} />
              <View style={styles.emptyMessageWrap}>
                <Text style={[styles.emptyMessageText, { color: theme.muted }]}>
                  {emptyMessage ?? 'No sales yet'}
                </Text>
              </View>
            </View>
          )}
          {!isEmpty && (
            <>
              <Animated.View pointerEvents="none" style={[styles.cursorLine, { backgroundColor: theme.border }, cursorStyle]} />
              <Animated.View pointerEvents="none" style={[styles.cursorDot, { backgroundColor: theme.accent, borderColor: theme.background }, dotStyle]} />
            </>
          )}
          {/* "Now" marker for Today: a static dot at the current hour's point
              (the line's real last point — nothing is drawn beyond it, since
              the API never returns future hours), so it's clear the chart
              stops at "now" rather than having simply run out of data.
              Hidden while actively scrubbing so it never fights the scrub
              cursor dot for the same spot. */}
          {showNowMarker && !isEmpty && tooltipIndex === null && points.length > 0 && (
            <View
              pointerEvents="none"
              testID="seller-dashboard-chart-now-marker"
              style={[
                styles.nowMarkerDot,
                {
                  backgroundColor: theme.accent,
                  borderColor: theme.background,
                  left: points[points.length - 1].x - 4,
                  top: points[points.length - 1].y - 4,
                },
              ]}
            />
          )}
          {!isEmpty && tooltipIndex !== null && points[tooltipIndex] && (
            <View
              pointerEvents="none"
              testID="seller-dashboard-chart-tooltip"
              style={[
                styles.tooltip,
                {
                  left: Math.max(4, Math.min(width - 4, points[tooltipIndex].x)),
                  top: Math.max(0, points[tooltipIndex].y - 46),
                },
              ]}
            >
              <Glass variant="regular" radius={10} style={StyleSheet.absoluteFill} />
              {labels[tooltipIndex] ? (
                <Text style={[styles.tooltipLabel, { color: theme.muted }]} numberOfLines={1}>
                  {labels[tooltipIndex]}
                </Text>
              ) : null}
              <Text style={[styles.tooltipText, { color: theme.text }]} numberOfLines={1}>
                {(formatValue ?? String)(values[tooltipIndex] ?? 0)}
              </Text>
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Axis labels sit directly under the chart curve they describe —
          Shopify/Robinhood-style chart → its own x-axis → range selector,
          not chart → range selector → labels (which read as detached from
          the chart entirely). Shown for the empty/fresh state too: a
          zero-sales chart still has correctly-labeled ranges, just a flat
          line instead of a real curve. */}
      {labels.length > 0 && width > 0 && visibleAxisIndices.length > 0 && (
        <View style={styles.axisRow} pointerEvents="none" testID="seller-dashboard-chart-axis">
          {visibleAxisIndices.map((bucketIndex, i) => {
            const n = visibleAxisIndices.length;
            const isFirst = n > 1 && i === 0;
            const isLast = n > 1 && i === n - 1;
            // Rendered in perfectly even PIXEL columns across the row,
            // independent of the underlying bucket's own x — selecting
            // `want` labels out of an uneven bucket count can't always land
            // on perfectly even *index* gaps (12 buckets / 6 labels rounds
            // to gaps of 2,2,3,2,2 — one integer gap is inevitably larger),
            // but the rendered columns themselves must still be even, or
            // that rounding artifact shows up as a visibly uneven gap.
            const t = n > 1 ? i / (n - 1) : 0.5;
            const x = t * width;
            // The first/last label anchor exactly to the chart's true
            // edges (x=0 / x=width) instead of being centered-then-clamped
            // like the middle labels — centering + clamping shifted the
            // whole FIXED-WIDTH box inward by half a label-width, shrinking
            // its gap to the next label relative to every other
            // (evenly-spaced) gap. A fixed-width box with only its inner
            // textAlign flipped does NOT fix this: the box itself (what
            // "where is this label" actually measures) stays the same
            // width and position, just the glyphs shift inside it — so the
            // edge boxes must drop the fixed AXIS_LABEL_WIDTH and size to
            // their own text instead, anchored with `left`/`right` (not a
            // computed `left` + textAlign) so the box's true edge sits
            // exactly at x=0 / x=width. Middle labels stay centered in a
            // fixed-width box on their evenly-spaced x — they never
            // approach either edge, so no clamping is needed there.
            if (isFirst) {
              return (
                <Text
                  key={`${labels[bucketIndex]}-${bucketIndex}`}
                  style={[styles.axisLabelBase, styles.axisLabelEdge, { color: theme.subtle, left: 0 }]}
                  numberOfLines={1}
                >
                  {labels[bucketIndex]}
                </Text>
              );
            }
            if (isLast) {
              return (
                <Text
                  key={`${labels[bucketIndex]}-${bucketIndex}`}
                  style={[styles.axisLabelBase, styles.axisLabelEdge, { color: theme.subtle, right: 0 }]}
                  numberOfLines={1}
                >
                  {labels[bucketIndex]}
                </Text>
              );
            }
            const left = Math.max(0, Math.min(width - AXIS_LABEL_WIDTH, x - AXIS_LABEL_WIDTH / 2));
            return (
              <Text
                key={`${labels[bucketIndex]}-${bucketIndex}`}
                style={[styles.axisLabelBase, styles.axisLabel, { color: theme.subtle, left }]}
                numberOfLines={1}
              >
                {labels[bucketIndex]}
              </Text>
            );
          })}
        </View>
      )}

      <View style={styles.rangeRow} onLayout={onRangeRowLayout} testID="seller-dashboard-range-pills">
        {rangeSegmentWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.rangeIndicatorWrap, rangeIndicatorStyle]}
            testID="seller-dashboard-range-indicator"
          >
            <Glass variant="pressed" radius={radius.md} style={StyleSheet.absoluteFill} />
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
  nowMarkerDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
  },
  emptyGridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  emptyBaseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  emptyMessageWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMessageText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
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
  tooltipLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
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
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  rangePill: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  rangeText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
  axisRow: {
    height: 16,
    marginTop: SP.xs,
  },
  // Shared base — deliberately has no `width`. RN's style-array flattening
  // does NOT let a later `width: undefined` unset an earlier numeric
  // `width` (the key is simply skipped, not applied as "auto"), so the
  // fixed-width middle-label style and the auto-width edge-label style
  // must each independently opt in to a `width`, rather than one trying to
  // cancel the other's.
  axisLabelBase: {
    position: 'absolute',
    top: 0,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
  },
  // Middle labels: fixed-width box, centered on their evenly-spaced x.
  axisLabel: {
    width: AXIS_LABEL_WIDTH,
    textAlign: 'center',
  },
  // Edge labels (first/last): no fixed width at all, so the rendered box
  // shrinks to the text itself and its true left/right edge lands exactly
  // at the chart's x=0 / x=width — see the render-time comment above.
  axisLabelEdge: {
    maxWidth: AXIS_LABEL_WIDTH * 1.5,
  },
});
