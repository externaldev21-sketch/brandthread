/**
 * Price — Vinted's price entry (label over one underlined amount field), with
 * the earnings breakdown laid out like Vinted's order summary rows (label
 * left, amount right, bold total) and Vestiaire's "You earn" wording.
 * Fee numbers come from the server's fee schedule; with none loaded the
 * breakdown is hidden rather than guessed.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GroupNote, ListingBottomBar } from '@/components/listing/ListingRows';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useFeeSchedule } from '@/hooks/useFeeSchedule';
import { bpsToPercentLabel, quoteFromSchedule } from '@/lib/feeSchedule';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';

export default function ListingPriceScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const form = useListing();
  const schedule = useFeeSchedule();
  const cents = parseDecimalToCents(form.priceStr);
  const invalid = form.priceStr.trim() !== '' && cents === null;
  const quote = schedule && cents && cents > 0 ? quoteFromSchedule(schedule, cents) : null;

  return (
    <View style={s.screen} testID="listing-price-screen">
      <ScreenHeader title="Price" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View style={s.field}>
          <Text style={s.label}>Price</Text>
          <View style={s.inputRow}>
            <Text style={s.currency}>$</Text>
            <TextInput
              value={form.priceStr}
              onChangeText={t => updateListing({ priceStr: t.replace(/[^0-9.]/g, '') })}
              placeholder="0.00"
              placeholderTextColor={theme.subtle}
              selectionColor={theme.text}
              keyboardType="decimal-pad"
              autoFocus
              style={s.input}
              accessibilityLabel="Price"
              testID="listing-price-input"
            />
          </View>
        </View>
        {invalid ? <Text style={s.error}>Enter an amount with up to two decimal places.</Text> : null}

        {quote && schedule ? (
          <View style={s.rows} testID="listing-earnings">
            <Row s={s} label="Price" value={formatCents(cents!)} />
            <Row s={s} label={`Brandthread fee (${bpsToPercentLabel(schedule.platformFeeBps)})`} value={`−${formatCents(quote.platformFeeCents)}`} />
            <Row s={s} label="Payment processing" value={`−${formatCents(quote.processingFeeCents)}`} />
            <View style={s.rule} />
            <Row s={s} label="You earn" value={formatCents(quote.sellerNetCents)} strong />
          </View>
        ) : null}
        <GroupNote>
          {form.shippingPayer === 'seller'
            ? 'You’re offering free shipping, so the label cost also comes out of your earnings.'
            : 'Buyers pay shipping on top of your price.'}
        </GroupNote>
      </ScrollView>
      <ListingBottomBar primaryLabel="Done" onPrimary={() => router.back()} primaryDisabled={invalid} primaryTestID="listing-price-done" />
    </View>
  );
}

function Row({ s, label, value, strong }: { s: ReturnType<typeof makeStyles>; label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, strong && s.rowStrong]}>{label}</Text>
      <Text style={[s.rowValue, strong && s.rowStrong]}>{value}</Text>
    </View>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    content: { paddingBottom: 24 },
    field: { paddingHorizontal: SP.md, paddingTop: SP.sm },
    label: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted, marginBottom: 6 },
    inputRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, paddingBottom: SP.sm },
    currency: { fontSize: FS.xl, fontFamily: FONT.semibold, color: t.text, marginRight: 4 },
    input: { flex: 1, fontSize: FS.xl, fontFamily: FONT.semibold, color: t.text, paddingVertical: 4 },
    error: { fontSize: FS.meta, fontFamily: FONT.regular, color: t.error, paddingHorizontal: SP.md, paddingTop: SP.sm },
    rows: { paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: SP.md, gap: SP.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: t.muted },
    rowValue: { fontSize: FS.base, fontFamily: FONT.regular, color: t.muted },
    rowStrong: { color: t.text, fontFamily: FONT.semibold },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: SP.xs },
  });
}
