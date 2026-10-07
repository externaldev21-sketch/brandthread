/**
 * Recoveries — lost chargebacks being recovered from the seller's upcoming
 * payouts (GET /api/finance/recoveries). Opened from the "Payouts paused"
 * row on Finance / Payouts and from the recovery notifications.
 *
 * Layout follows Stripe Dashboard's Balances + payout detail (Mobbin
 * reference in the PR): a label/value summary with the signed total on top,
 * then one card per chargeback with label/value rows and its recovery
 * timeline. Reskinned to the app's monochrome palette.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';
import { RetryRow } from '@/components/ui/RetryRow';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import {
  applicationLabel, disputeReasonText, recoveryStatusLabel, recoveryTitle, signedBalance,
  type RecoveriesResponse, type SellerRecovery,
} from '@/lib/recoveries';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function RecoveriesScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const tabBar = useTabBarMetrics(2);
  const { isLoaded, isSignedIn, userId } = useAuth();
  const previewMode = isSellerDevPreview();
  const signedOutPreview = previewMode && (!userId || !isLoaded || !isSignedIn);
  const [data, setData] = useState<RecoveriesResponse | null>(null);
  const [loading, setLoading] = useState(!signedOutPreview);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (signedOutPreview) {
      setData({ recoveries: [], recoveryOwedCents: 0, payoutsPaused: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      setData(await api.finance.recoveries());
    } catch {
      setError(true);
    }
    setLoading(false);
  }, [api, signedOutPreview]);

  useEffect(() => { void load(); }, [load]);

  const recoveries = data?.recoveries ?? [];
  const recovered = recoveries.reduce((sum, r) => sum + r.recoveredCents, 0);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Recoveries" />
      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: tabBar.occupiedHeight + SP.lg }}
        showsVerticalScrollIndicator={false}
      >
        {loading && !data ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: SP.xl }} />
        ) : error && !data ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <RetryRow label="Couldn't load recoveries" onRetry={() => { void load(); }} />
          </View>
        ) : recoveries.length === 0 ? (
          <EmptyState icon="check-circle" title="Nothing to recover" message="Lost chargebacks that need recovering from your payouts show up here." />
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="recoveries-summary">
              <Row label="Owed" value={signedBalance(-(data?.recoveryOwedCents ?? 0))} strong />
              <Row label="Recovered so far" value={formatCents(recovered)} />
              <Row label="Payouts" value={data?.payoutsPaused ? 'Paused' : 'Active'} last />
            </View>

            <Text style={[styles.section, { color: colors.mutedForeground }]}>CHARGEBACKS</Text>
            {recoveries.map((r) => (
              <RecoveryCard key={r.id} recovery={r} onOpenOrder={r.orderId ? () => router.push(`/order-detail?id=${encodeURIComponent(r.orderId!)}` as never) : undefined} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, strong, last }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: strong ? colors.foreground : colors.mutedForeground, fontFamily: strong ? FONT.semibold : FONT.regular }]}>{label}</Text>
      <Text style={[styles.rowValue, TABULAR_NUMS, { color: colors.foreground, fontFamily: strong ? FONT.bold : FONT.medium }]}>{value}</Text>
    </View>
  );
}

function RecoveryCard({ recovery: r, onOpenOrder }: { recovery: SellerRecovery; onOpenOrder?: () => void }) {
  const colors = useColors();
  const events = [
    { id: `${r.id}-lost`, label: 'Chargeback lost', amount: `−${formatCents(r.amountCents + r.feeCents)}`, at: r.createdAt },
    ...r.applications.map((a) => ({ id: a.id, label: applicationLabel(a), amount: `+${formatCents(a.amountCents)}`, at: a.createdAt })),
  ];
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="recovery-card">
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]} onPress={onOpenOrder}>{recoveryTitle(r)}</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{disputeReasonText(r.disputeReason)}</Text>
        </View>
        <View style={[styles.pill, { borderColor: colors.border, backgroundColor: r.status === 'open' ? colors.secondary : 'transparent' }]}>
          <Text style={[styles.pillText, { color: r.status === 'open' ? colors.foreground : colors.mutedForeground }]}>{recoveryStatusLabel(r.status)}</Text>
        </View>
      </View>

      <Row label="Your share of the sale" value={formatCents(r.amountCents)} />
      <Row label="Stripe dispute fee" value={formatCents(r.feeCents)} />
      {r.heldCancelledCents > 0 && <Row label="Not paid out (held)" value={formatCents(r.heldCancelledCents)} />}
      <Row label="Recovered" value={formatCents(r.recoveredCents)} />
      <Row label="Still owed" value={formatCents(r.outstandingCents)} strong last />

      <View style={[styles.timeline, { borderTopColor: colors.border }]}>
        {events.map((e, i) => (
          <View key={e.id} style={styles.event}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: i === 0 ? colors.foreground : colors.mutedForeground }]} />
              {i < events.length - 1 && <View style={[styles.line, { backgroundColor: colors.border }]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: i < events.length - 1 ? SP.sm : 0 }}>
              <Text style={[styles.eventLabel, { color: colors.foreground }]}>{e.label}</Text>
              <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{fmtDate(e.at)}</Text>
            </View>
            <Text style={[styles.eventAmount, TABULAR_NUMS, { color: colors.foreground }]}>{e.amount}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  card: { borderWidth: 1, borderRadius: RADIUS.lg, paddingHorizontal: SP.md, paddingVertical: SP.xs, marginBottom: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, gap: SP.sm },
  rowLabel: { fontSize: FS.sm, flexShrink: 1 },
  rowValue: { fontSize: FS.sm },
  section: { fontFamily: FONT.medium, fontSize: FS.xs, letterSpacing: 0.5, marginTop: SP.sm, marginBottom: SP.sm },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, paddingTop: SP.sm, paddingBottom: SP.xs },
  cardTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  cardSub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  pill: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontFamily: FONT.medium, fontSize: FS.xs },
  timeline: { borderTopWidth: 1, paddingVertical: SP.md },
  event: { flexDirection: 'row', gap: SP.sm },
  rail: { width: 10, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  line: { width: 1, flex: 1, marginTop: 2 },
  eventLabel: { fontFamily: FONT.medium, fontSize: FS.sm },
  eventDate: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 1 },
  eventAmount: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
