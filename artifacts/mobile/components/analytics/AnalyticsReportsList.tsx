import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';
import { Card, CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';

/** Mobbin reference: Shopify Analytics "Reports" rows above the overview. */
export const ANALYTICS_REPORTS: { label: string; icon: keyof typeof Feather.glyphMap; href: string; badge?: string }[] = [
  { label: 'Product stats', icon: 'shopping-bag', href: '/analytics-product-stats' },
  { label: 'Threads and videos', icon: 'play-circle', href: '/analytics-content' },
  { label: 'Audience', icon: 'users', href: '/analytics-audience' },
  { label: 'Goals', icon: 'target', href: '/analytics-goals' },
  { label: 'Export', icon: 'download', href: '/analytics-export' },
  { label: 'Advanced analytics', icon: 'trending-up', href: '/analytics-advanced', badge: 'PRO' },
  { label: 'Customer cohorts and lifetime value', icon: 'users', href: '/analytics-cohorts', badge: 'PRO' },
];

/** Entry points to the seller reports; appended to the Analytics tab. */
export function AnalyticsReportsList() {
  const colors = useColors();
  const router = useRouter();
  const s = React.useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget + 4, paddingHorizontal: SP.md, gap: SP.sm },
    label: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
    badge: { borderRadius: RADIUS.xs, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: colors.foreground, letterSpacing: 0.5 },
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
              testID={`report-${r.href.replace('/analytics-', '')}`}
              onPress={() => { Haptics.selectionAsync(); router.push(r.href as never); }}
            >
              <Feather name={r.icon} size={18} color={colors.foreground} />
              <Text style={s.label}>{r.label}</Text>
              {!!r.badge && <View style={s.badge}><Text style={s.badgeText}>{r.badge}</Text></View>}
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ))}
      </Card>
    </View>
  );
}
