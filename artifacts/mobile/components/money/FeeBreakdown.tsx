/**
 * Sale price -> Brandthread fee -> payment processing -> "You receive".
 * Numbers come from the server's fee schedule (useFeeSchedule); with no
 * schedule (signed out / offline) or no price the component renders nothing.
 *
 * `collapsible` renders a single compact row ("You receive $X" + chevron) that
 * expands into the full breakdown, for dropping under an existing price field.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useFeeSchedule } from '@/hooks/useFeeSchedule';
import { bpsToPercentLabel, quoteFromSchedule, type FeeSchedule } from '@/lib/feeSchedule';
import { formatCents } from '@/lib/money';

interface Props {
  priceCents: number | null | undefined;
  shippingCents?: number;
  collapsible?: boolean;
  /** Bare rows (no card chrome) for use inside an existing card. */
  flat?: boolean;
  /** Skip the fetch when the caller already holds a schedule. */
  schedule?: FeeSchedule | null;
  testID?: string;
}

export function FeeBreakdown({ priceCents, shippingCents, collapsible, flat, schedule: given, testID = 'fee-breakdown' }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fetched = useFeeSchedule();
  const schedule = given ?? fetched;
  const [open, setOpen] = useState(false);

  const quote = useMemo(
    () => (schedule && priceCents && priceCents > 0 ? quoteFromSchedule(schedule, priceCents, { shippingCents }) : null),
    [schedule, priceCents, shippingCents],
  );
  if (!schedule || !quote || !priceCents) return null;

  const rows = (
    <View style={flat ? undefined : styles.rows}>
      <Row styles={styles} label="Sale price" value={formatCents(priceCents)} />
      <Row styles={styles} label={`Brandthread fee (${bpsToPercentLabel(schedule.platformFeeBps)})`} value={`-${formatCents(quote.platformFeeCents)}`} />
      <Row styles={styles} label="Payment processing" value={`-${formatCents(quote.processingFeeCents)}`} />
      <View style={styles.rule} />
      <Row styles={styles} label="You receive" value={formatCents(quote.sellerNetCents)} strong />
    </View>
  );

  if (!collapsible) {
    return <View testID={testID} style={flat ? undefined : styles.card}>{rows}</View>;
  }
  return (
    <View testID={testID} style={styles.card}>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setOpen(o => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Fees and what you receive"
        testID={`${testID}-toggle`}
      >
        <Text style={styles.toggleLabel}>You receive</Text>
        <Text style={styles.toggleValue}>{formatCents(quote.sellerNetCents)}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.muted} />
      </TouchableOpacity>
      {open ? <View style={styles.expanded}>{rows}</View> : null}
    </View>
  );
}

function Row({ styles, label, value, strong }: { styles: ReturnType<typeof createStyles>; label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  card: { borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.lg, backgroundColor: theme.card, overflow: 'hidden' },
  rows: { paddingVertical: SP.xs },
  expanded: { borderTopWidth: 1, borderTopColor: theme.border },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: 44 },
  toggleLabel: { flex: 1, color: theme.muted, fontSize: FS.sm, fontFamily: FONT.medium },
  toggleValue: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.semibold },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 6 },
  label: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular },
  value: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.medium },
  strong: { color: theme.text, fontFamily: FONT.semibold },
  rule: { height: 1, backgroundColor: theme.border, marginHorizontal: SP.md, marginVertical: 4 },
});
