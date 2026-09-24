import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { formatCentsCompact, formatCompactCount } from '@/lib/compactFormat';
import { computeMetricChange } from '@/lib/sellerMetricChange';
import { BORDER_SUBTLE, FONT, FS, MUTED, RADIUS, SP, SUBTLE } from '@/lib/theme';

export interface SellerMetricPage {
  key: string;
  label: string;
  /** Raw value in cents (isMoney) or a plain count. */
  value: number;
  isMoney: boolean;
  /** Same period one cycle back, when a real comparison exists (absent for balances). */
  previousValue?: number;
  /** Per-bucket series for the same metric over the selected range, when real data exists. */
  spark?: number[];
  route: string;
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

/** Catmull-Rom -> cubic Bezier smoothing, so the trend reads as a soft curve
 * instead of jagged straight segments between buckets — a small but very
 * visible "premium" touch on the primary dashboard number. */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function Sparkline({ values, width, height, color }: { values: number[]; width: number; height: number; color: string }) {
  if (values.length < 2 || width <= 0) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  // Keep a hairline of padding at top/bottom so the curve never clips.
  const pad = height * 0.08;
  const usableHeight = height - pad * 2;
  const points = values.map((v, i) => ({
    x: i * stepX,
    y: pad + usableHeight - ((v - min) / range) * usableHeight,
  }));
  const linePath = smoothPath(points);
  const gradientId = `sellerMetricSparklineFill-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const areaPath = `${linePath} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.28} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <Path d={linePath} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

// ─── Count-up ───────────────────────────────────────────────────────────────

function useCountUp(target: number, active: boolean, durationMs = 650): number {
  const [display, setDisplay] = useState(active ? target : 0);
  const fromRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    fromRef.current = 0;
    startRef.current = null;
    const step = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const progress = Math.min(1, (t - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(fromRef.current + (target - fromRef.current) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, active, durationMs]);

  return active ? display : target;
}

// ─── One page ───────────────────────────────────────────────────────────────

function MetricPageCard({
  page, isActive, width, theme, onOpen,
}: {
  page: SellerMetricPage;
  isActive: boolean;
  width: number;
  theme: AppThemePreset;
  onOpen: (route: string) => void;
}) {
  const [showExact, setShowExact] = useState(false);
  const displayValue = useCountUp(page.value, isActive);
  const change = page.previousValue != null ? computeMetricChange(page.value, page.previousValue) : null;

  const compact = page.isMoney ? formatCentsCompact(displayValue) : formatCompactCount(displayValue);
  const exact = page.isMoney ? formatCents(page.value) : String(page.value);
  const shown = showExact ? exact : compact;

  const changeColor = change?.direction === 'up' ? theme.success : change?.direction === 'down' ? theme.error : theme.muted;
  const changeIcon = change?.direction === 'up' ? 'arrow-up-right' : change?.direction === 'down' ? 'arrow-down-right' : 'minus';
  const changeSpokenLabel = !change
    ? ''
    : change.direction === 'flat'
      ? ', unchanged vs previous period'
      : change.percent == null
        ? ', new this period'
        : `, ${change.direction} ${Math.abs(change.percent)}% vs previous period`;

  return (
    <TouchableOpacity
      testID={`seller-metric-page-${page.key}`}
      accessibilityRole="button"
      accessibilityLabel={`${page.label}: ${exact}${changeSpokenLabel}. Opens ${page.label} details.`}
      style={[styles.page, { width }]}
      activeOpacity={0.85}
      onPress={() => onOpen(page.route)}
      onLongPress={() => setShowExact(true)}
      onPressOut={() => setShowExact(false)}
      delayLongPress={350}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.label}>{page.label}</Text>
        <Feather name="chevron-right" size={16} color={SUBTLE} />
      </View>

      <Text
        style={[styles.value, { color: theme.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
      >
        {shown}
      </Text>

      <View style={styles.footerRow}>
        {change ? (
          <View style={styles.changeRow}>
            <Feather name={changeIcon as keyof typeof Feather.glyphMap} size={13} color={changeColor} />
            <Text style={[styles.changeText, { color: changeColor }]}>
              {change.percent == null ? 'New' : `${Math.abs(change.percent)}%`}
            </Text>
            <Text style={styles.changeCaption}>vs last period</Text>
          </View>
        ) : (
          <View style={styles.changeRow} />
        )}
        {page.spark && page.spark.length > 1 && (
          <Sparkline values={page.spark} width={72} height={24} color={theme.accent} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Carousel ───────────────────────────────────────────────────────────────

export function SellerMetricCarousel({ pages, theme, onOpenPage }: { pages: SellerMetricPage[]; theme: AppThemePreset; onOpenPage: (route: string) => void }) {
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const lastSnappedIndex = useRef(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (Math.abs(next - width) > 0.5) setWidth(next);
  }, [width]);

  const onMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    const clamped = Math.max(0, Math.min(pages.length - 1, index));
    if (clamped !== lastSnappedIndex.current) {
      lastSnappedIndex.current = clamped;
      Haptics.selectionAsync().catch(() => {});
    }
    setActiveIndex(clamped);
  }, [pages.length, width]);

  // Keep paging in range if the page count ever changes under an open scroll position.
  useEffect(() => {
    if (activeIndex >= pages.length) setActiveIndex(0);
  }, [activeIndex, pages.length]);

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <ScrollView
          ref={scrollRef}
          testID="seller-metric-carousel"
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          scrollEventThrottle={16}
        >
          {pages.map((page, index) => (
            <MetricPageCard
              key={page.key}
              page={page}
              isActive={index === activeIndex}
              width={width}
              theme={theme}
              onOpen={onOpenPage}
            />
          ))}
        </ScrollView>
      )}
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {pages.map((page, index) => (
          <View
            key={page.key}
            style={[
              styles.dot,
              { backgroundColor: index === activeIndex ? theme.accent : BORDER_SUBTLE },
              index === activeIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    minHeight: 128,
    justifyContent: 'space-between',
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    letterSpacing: 0.2,
  },
  value: {
    fontFamily: FONT.bold,
    fontSize: FS.xxl * 1.35,
    letterSpacing: -0.8,
    marginTop: SP.xs,
    width: '100%',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SP.sm,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 18,
  },
  changeText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
  },
  changeCaption: {
    color: SUBTLE,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginLeft: 2,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: SP.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 16,
  },
});
