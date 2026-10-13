import * as Haptics from 'expo-haptics';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

import { useRouter } from 'expo-router';

import { useColors } from '@/hooks/useColors';

import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';

import { Card, CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';

/**
 * Mobbin reference: Shopify Analytics "Reports" rows above the overview.
 * Every row opens its report on the one Reports route (app/analytics-reports).
 */
export const ANALYTICS_REPORTS: { label: string; icon: IconName; href: string; badge?: string }[] = [
  { label: 'Product stats', icon: 'shopping-bag', href: '/analytics-reports?report=product-stats' },
  { label: 'Threads and videos', icon: 'play-circle', href: '/analytics-reports?report=content' },
  { label: 'Audience', icon: 'users', href: '/analytics-reports?report=audience' },
  { label: 'Goals', icon: 'target', href: '/analytics-reports?report=goals' },
  { label: 'Export', icon: 'download', href: '/analytics-reports?report=export', badge: 'PRO' },
  { label: 'Advanced analytics', icon: 'trending-up', href: '/analytics-reports?report=advanced', badge: 'GROWTH' },
  { label: 'Customer cohorts and lifetime value', icon: 'users', href: '/analytics-reports?report=cohorts', badge: 'GROWTH' },
];

/** Entry points to the seller reports; appended to the Analytics tab. */
export function AnalyticsReportsList() {
  const colors = useColors();
  const router = useRouter();
  const s = React.useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget + 4, paddingHorizontal: SP.md, gap: SP.sm },
    label: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
    badge: { borderRadius: RADIUS.xs, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: colors.foreground },
  }), [colors]);
  return (
    <View>
      <SectionTitle>Reports</SectionTitle>
      <Card>
        {ANALYTICS_REPORTS.map((r, i) => (
          <View key={r.href}>
            {i > 0 && <CardDivider />}
            <TouchableOpacity
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={r.badge ? `${r.label}, ${r.badge}` : r.label}
              testID={`report-${r.href.split('report=')[1]}`}
              onPress={() => {  router.push(r.href as never); }}
            >
              <Icon name={r.icon} size={18} color={colors.foreground} />
              <Text style={s.label}>{r.label}</Text>
              {!!r.badge && <View style={s.badge}><Text style={s.badgeText}>{r.badge}</Text></View>}
              <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ))}
      </Card>
    </View>
  );
}
