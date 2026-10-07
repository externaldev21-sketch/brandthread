/**
 * Shown on the seller's Finance and Payouts screens only while a lost
 * chargeback is being recovered (GET /api/finance/balance|summary →
 * payoutsPaused). The balance is net of what is owed and can be negative;
 * the "Payouts paused" row opens the Recoveries screen.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { hapticLight } from '@/lib/haptics';
import { pausedRowCaption, signedBalance } from '@/lib/recoveries';

export function RecoveryPauseCard({
  owedCents, balanceCents, onPress, showBalance = true, style,
}: {
  owedCents: number;
  /** Available minus owed (may be negative); null hides the balance line. */
  balanceCents: number | null;
  onPress: () => void;
  showBalance?: boolean;
  style?: any;
}) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]} testID="recovery-pause-card">
      {showBalance && balanceCents !== null && (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Balance</Text>
          <Text style={[styles.balance, TABULAR_NUMS, { color: colors.foreground }]} testID="recovery-balance">
            {signedBalance(balanceCents)}
          </Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        </>
      )}
      <Pressable
        onPress={() => { hapticLight(); onPress(); }}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Payouts paused. ${pausedRowCaption(owedCents)}`}
        testID="recovery-paused-row"
      >
        <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
          <Feather name="pause" size={15} color={colors.foreground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Payouts paused</Text>
          <Text style={[styles.rowCaption, { color: colors.mutedForeground }]}>{pausedRowCaption(owedCents)}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md, marginBottom: 20 },
  label: { fontFamily: FONT.medium, fontSize: FS.xs },
  balance: { fontFamily: FONT.bold, fontSize: 30, letterSpacing: -0.5, marginTop: 2 },
  divider: { height: 1, marginVertical: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: FONT.semibold, fontSize: FS.sm },
  rowCaption: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
});
