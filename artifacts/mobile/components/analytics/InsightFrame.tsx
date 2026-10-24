import { radius as ControlRadius } from '@/constants/radii';

/**
 * Shared chrome for the seller analytics report screens: the app's standard
 * header (bare back arrow, no subtitle), the Dashboard's Today / Week / Month
 * / Year / All pills, loading and error states, and a small bottom inset.
 * Pushed report screens already end above the floating seller tab bar: the
 * stack scene applies that clearance once (useSceneBottomClearance in
 * components/layout/ScreenChrome.tsx), so adding it here again left a
 * second bar-height gap under every report.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';

import { haptics, haptic } from '@/lib/haptics';


import { FONT, FS, RADIUS, SP } from '@/lib/theme';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader, type ScreenHeaderAction } from '@/components/ScreenHeader';

import { ErrorState } from '@/components/ui/ErrorState';

import { AnalyticsSkeleton } from '@/components/analytics/AnalyticsKit';

import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';

import { SellerDashboardRangePills } from '@/components/SellerDashboardRangePills';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { INSIGHT_RANGES, type InsightRange } from '@/services/sellerInsightsService';

/** Breathing room under a pushed report's last card (the bar clearance itself comes from the stack scene). */
export function useReportBottomInset(): number {
  return SP.lg;
}

export function InsightFrame({
  title, loading, error, onRetry, onRefresh, range, onRangeChange, actions, children,
}: {
  title: string; loading: boolean; error: boolean; onRetry: () => void; onRefresh?: () => void;
  range?: InsightRange; onRangeChange?: (r: InsightRange) => void; actions?: ScreenHeaderAction[]; children: React.ReactNode;
}) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const bottom = useReportBottomInset();
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={title} actions={actions} />
      {loading ? (
        <AnalyticsSkeleton kpiCount={2} listRows={3} />
      ) : error ? (
        <View style={s.center}><ErrorState message="Couldn't load this report." onRetry={onRetry} /></View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: bottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        >
          {range && onRangeChange && (
            <SellerDashboardRangePills range={range} onRangeChange={onRangeChange} theme={theme} />
          )}
          {children}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

/** Equal-width segmented pills: every option the same width and height. */
export function SegmentedPills<T extends string>({ options, value, onChange, testID }: {
  options: { key: T; label: string }[]; value: T; onChange: (k: T) => void; testID?: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: SP.xs, marginBottom: SP.md }} testID={testID}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            onPress={() => { haptic('select'); onChange(o.key); }}
            style={{
              flex: 1, minHeight: 40, borderRadius: ControlRadius.md, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: SP.xs, borderWidth: 1,
              backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: active ? colors.primaryForeground : colors.mutedForeground }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
