/**
 * Fees & payments — what Brandthread and the payment processor take from a
 * sale, plus a calculator ("Etsy fees & payments" layout, in our palette).
 * Every number comes from the server's fee schedule (hooks/useFeeSchedule);
 * this screen defines none. The schedule endpoint is public, so the
 * signed-out preview never calls a protected API.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { FeeBreakdown } from '@/components/money/FeeBreakdown';
import { retryFeeSchedule, useFeeSchedule } from '@/hooks/useFeeSchedule';
import { bpsToPercentLabel, processingRateLabel } from '@/lib/feeSchedule';
import { parseDecimalToCents } from '@/lib/money';

export default function FeesScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const schedule = useFeeSchedule();
  const [priceText, setPriceText] = useState('');
  const priceCents = parseDecimalToCents(priceText);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Fees & payments" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!schedule ? (
            <RetryRow label="Couldn't load fees" onRetry={retryFeeSchedule} testID="fees-retry" />
          ) : (
            <>
              <Text style={styles.sectionTitle}>Selling fees</Text>
              <View style={styles.card} testID="fees-table">
                <FeeRow styles={styles} label="Brandthread fee" note="On the item price + shipping" value={bpsToPercentLabel(schedule.platformFeeBps)} />
                <FeeRow styles={styles} label="Payment processing" note="On the total the buyer pays" value={processingRateLabel(schedule)} last />
              </View>

              <Text style={styles.sectionTitle}>Fee calculator</Text>
              <View style={styles.card}>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Sale price</Text>
                  <View style={styles.inputWrap}>
                    <Text style={styles.currency}>$</Text>
                    <TextInput
                      testID="fees-price-input"
                      style={styles.input}
                      value={priceText}
                      onChangeText={setPriceText}
                      placeholder="0.00"
                      placeholderTextColor={theme.subtle}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Sale price"
                    />
                  </View>
                </View>
                {priceCents && priceCents > 0 ? (
                  <View style={styles.result}>
                    <FeeBreakdown flat priceCents={priceCents} schedule={schedule} testID="fees-calculator-result" />
                  </View>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FeeRow({ styles, label, note, value, last }: { styles: ReturnType<typeof createStyles>; label: string; note: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.feeRow, !last && styles.feeRowRule]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.feeLabel}>{label}</Text>
        <Text style={styles.feeNote}>{note}</Text>
      </View>
      <Text style={styles.feeValue}>{value}</Text>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1 },
  content: { padding: SP.md, paddingBottom: SP.xl * 2, gap: SP.sm },
  sectionTitle: { color: theme.muted, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: SP.sm, marginBottom: 2 },
  card: { backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md },
  feeRowRule: { borderBottomWidth: 1, borderBottomColor: theme.border },
  feeLabel: { color: theme.text, fontSize: FS.base, fontFamily: FONT.medium },
  feeNote: { color: theme.muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  feeValue: { color: theme.text, fontSize: FS.base, fontFamily: FONT.semibold },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SP.md, gap: SP.md },
  inputLabel: { flexShrink: 0, color: theme.text, fontSize: FS.base, fontFamily: FONT.medium },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md, paddingHorizontal: SP.md, flex: 1, minWidth: 0, height: 44 },
  currency: { color: theme.muted, fontSize: FS.base, fontFamily: FONT.medium, marginRight: 4 },
  input: { flex: 1, minWidth: 0, color: theme.text, fontSize: FS.base, fontFamily: FONT.medium, textAlign: 'right', padding: 0 },
  result: { borderTopWidth: 1, borderTopColor: theme.border, paddingVertical: SP.xs },
});
