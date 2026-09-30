import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { AnalyticsSkeleton } from '@/components/analytics/AnalyticsKit';
import { INSIGHT_RANGES, type InsightRange } from '@/services/sellerInsightsService';

/** Shared chrome for the seller insight screens: header, optional range pills, loading and error states. */
export function InsightFrame({
  title, loading, error, onRetry, onRefresh, range, onRangeChange, children,
}: {
  title: string; loading: boolean; error: boolean; onRetry: () => void; onRefresh?: () => void;
  range?: InsightRange; onRangeChange?: (r: InsightRange) => void; children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={title} />
      {loading ? (
        <AnalyticsSkeleton kpiCount={3} listRows={3} />
      ) : error ? (
        <View style={s.center}><ErrorState message="Couldn't load this report." onRetry={onRetry} /></View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        >
          {range && onRangeChange && (
            <SegmentedPills options={INSIGHT_RANGES} value={range} onChange={onRangeChange} />
          )}
          {children}
          <View style={{ height: 120 }} />
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
export function SegmentedPills<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[]; value: T; onChange: (k: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: SP.xs, marginBottom: SP.md }}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => { Haptics.selectionAsync(); onChange(o.key); }}
            style={{
              flex: 1, minHeight: 40, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: SP.sm, borderWidth: 1,
              backgroundColor: active ? colors.accent : colors.card, borderColor: active ? colors.primary : colors.border,
            }}
          >
            <Text style={{ fontSize: FS.xs + 1, fontFamily: FONT.medium, color: active ? colors.accentForeground : colors.mutedForeground }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
