import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { COMP, FONT, FS, SP } from '@/lib/theme';
import { Card, CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';

const REPORTS: { label: string; icon: keyof typeof Feather.glyphMap; href: string }[] = [
  { label: 'Product stats', icon: 'shopping-bag', href: '/analytics-product-stats' },
  { label: 'Threads and videos', icon: 'play-circle', href: '/analytics-content' },
  { label: 'Audience', icon: 'users', href: '/analytics-audience' },
  { label: 'Best time to post', icon: 'clock', href: '/analytics-best-time' },
  { label: 'Goals', icon: 'target', href: '/analytics-goals' },
  { label: 'Export', icon: 'download', href: '/analytics-export' },
];

/** Entry points to the seller insight reports; appended to the Analytics tab. */
export function AnalyticsReportsList() {
  const colors = useColors();
  const router = useRouter();
  const s = React.useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.md, gap: SP.sm },
    label: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
  }), [colors]);
  return (
    <View>
      <SectionTitle>Reports</SectionTitle>
      <Card>
        {REPORTS.map((r, i) => (
          <View key={r.href}>
            {i > 0 && <CardDivider />}
            <TouchableOpacity
              style={s.row}
              accessibilityRole="button"
              onPress={() => { Haptics.selectionAsync(); router.push(r.href as never); }}
            >
              <Feather name={r.icon} size={18} color={colors.foreground} />
              <Text style={s.label}>{r.label}</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ))}
      </Card>
    </View>
  );
}
