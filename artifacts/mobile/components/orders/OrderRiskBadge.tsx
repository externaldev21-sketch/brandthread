/**
 * Seller-only pill on the order screen when Stripe Radar / review signals
 * make an order worth a second look before it ships. Rendered only for
 * `risk.level` elevated or highest (GET /api/orders/:id `risk`); tapping
 * opens an opaque in-screen panel listing the flags. Never shown to buyers
 * (the buyer order endpoints do not return risk data).
 *
 * Silver / black only.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export type OrderRisk = {
  level: 'normal' | 'elevated' | 'highest';
  score?: number | null;
  reviewed?: boolean;
  flags: { code: string; label: string; severity: 'info' | 'medium' | 'high' }[];
};

export function shouldShowOrderRisk(risk: OrderRisk | null | undefined): risk is OrderRisk {
  return !!risk && (risk.level === 'elevated' || risk.level === 'highest');
}

export function OrderRiskBadge({ risk }: { risk: OrderRisk | null | undefined }) {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  if (!shouldShowOrderRisk(risk)) return null;
  const SILVER = theme.muted;
  const WHITE = theme.text;
  const BLACK = theme.background;
  const highest = risk.level === 'highest';
  const label = highest ? 'High risk · review before shipping' : 'Review before shipping';

  return (
    <View style={styles.wrap} testID="order-risk">
      <Pressable
        onPress={() => setOpen(v => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}. Show why`}
        testID="order-risk-badge"
        style={[styles.pill, { backgroundColor: highest ? WHITE : SILVER }]}
      >
        <Icon name="shield" size={12} color={BLACK} />
        <Text style={[styles.pillText, { color: BLACK }]}>{label}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={BLACK} />
      </Pressable>

      {open && (
        <View
          testID="order-risk-panel"
          style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.panelTitle, { color: theme.text }]}>Why this order is flagged</Text>
          {risk.flags.map(flag => (
            <View key={flag.code} style={styles.flagRow}>
              <View
                style={[
                  styles.dot,
                  flag.severity === 'high' && { backgroundColor: WHITE, borderColor: WHITE },
                  flag.severity === 'medium' && { backgroundColor: SILVER, borderColor: SILVER },
                  flag.severity === 'info' && { backgroundColor: 'transparent', borderColor: SILVER },
                ]}
              />
              <Text style={[styles.flagText, { color: theme.text }]}>{flag.label}</Text>
            </View>
          ))}
          {typeof risk.score === 'number' && (
            <Text style={[styles.score, { color: theme.muted }]}>Stripe risk score {risk.score} of 99</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SP.sm, alignSelf: 'stretch' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs + 2, alignSelf: 'flex-start',
    borderRadius: RADIUS.pill, paddingHorizontal: SP.sm + 2, paddingVertical: SP.xs + 2, minHeight: 28,
  },
  pillText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  panel: { marginTop: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, gap: SP.sm },
  panelTitle: { fontSize: FS.sm, fontFamily: FONT.semibold },
  flagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, marginTop: 5 },
  flagText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 19 },
  score: { fontSize: FS.meta, fontFamily: FONT.regular },
});
