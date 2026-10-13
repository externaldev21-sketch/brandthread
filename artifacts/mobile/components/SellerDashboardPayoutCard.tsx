/**
 * Dashboard next payout: the amount big, the date small, and a thin bar
 * showing how far through the current payout cycle today is. Only real
 * data — the server's `nextPayoutEstimate` (Stripe's pending payout, or the
 * schedule's next run over the available balance) and the Stripe payout
 * schedule interval. With no dated payout this renders nothing, and with no
 * known schedule the bar is left out (never guessed).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import {
  datedNextPayout,
  payoutProgress,
  type NextPayoutEstimate,
  type PayoutScheduleSummary,
} from '@/lib/sellerDashboardHome';
import { FONT, SP } from '@/lib/theme';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatPayoutDate(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function SellerDashboardPayoutCard({
  estimate,
  schedule,
  theme,
  onOpen,
  now,
}: {
  estimate: NextPayoutEstimate | null | undefined;
  schedule: PayoutScheduleSummary | null | undefined;
  theme: AppThemePreset;
  onOpen: () => void;
  now?: number;
}) {
  const payout = datedNextPayout(estimate);
  if (!payout || !payout.date) return null;
  const progress = payoutProgress(payout, schedule, now);

  return (
    <PressableScale
      onPress={onOpen}
      style={styles.root}
      accessibilityRole="button"
      accessibilityLabel={`Next payout ${payout.formatted} on ${formatPayoutDate(payout.date)}, open Payouts`}
      testID="seller-dashboard-next-payout"
    >
      <Text style={[styles.label, { color: theme.muted }]}>Next payout</Text>
      <Text style={[styles.amount, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {payout.formatted}
      </Text>
      <Text style={[styles.date, { color: theme.muted }]} numberOfLines={1}>{formatPayoutDate(payout.date)}</Text>
      {progress != null && (
        <View style={[styles.track, { backgroundColor: theme.borderSubtle }]} testID="seller-dashboard-payout-progress">
          <View style={[styles.fill, { backgroundColor: theme.text, width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'stretch', paddingBottom: SP.md },
  label: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 },
  amount: { fontFamily: FONT.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, marginTop: SP.xs, fontVariant: ['tabular-nums'] },
  date: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 12 },
  fill: { height: 4, borderRadius: 2 },
});
