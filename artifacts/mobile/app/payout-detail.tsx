import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout';
import { RoleLockedView } from '@/components/RoleLockedView';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { hasPayoutsAccess, isManagerRole } from '@/lib/roleError';
import { useTeamRole } from '@/hooks/useTeamRole';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { breakdownRows, fmtDate, payoutStatusLabel, type PayoutDetail } from '@/lib/payoutScheduleView';

const line = (amount: number) => ({
  amount,
  formatted: `${amount < 0 ? '-' : ''}$${(Math.abs(amount) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
});

function demoDetail(id: string): PayoutDetail {
  const base = {
    connected: true,
    breakdown: {
      lines: {
        sales: line(124_000), platformFee: line(-6_200), stripeFee: line(-3_890), refunds: line(-9_800),
        disputes: line(0), holds: line(-2_500), adjustments: line(0),
      },
      net: line(101_610), reconciled: true, remainder: line(0), transactionCount: 9, truncated: false,
    },
  };
  const payout = {
    id, amount: 101_610, formatted: '$1,016.10', method: 'standard', automatic: true,
    created: '2026-09-25T12:00:00.000Z', arrivalDate: '2026-09-28T12:00:00.000Z',
    failureMessage: null, destination: { last4: '6789', brand: 'Chase' }, instantFee: null,
  };
  if (id.endsWith('transit')) return { ...base, payout: { ...payout, status: 'in_transit', arrivalDate: '2026-10-02T12:00:00.000Z' } };
  if (id.endsWith('failed')) {
    return {
      ...base,
      payout: { ...payout, status: 'failed', failureMessage: 'The bank account could not receive this payout.' },
    };
  }
  if (id.endsWith('manual')) {
    return {
      connected: true, breakdown: null,
      payout: { ...payout, status: 'paid', automatic: false, method: 'instant', formatted: '$990.00', amount: 99_000, instantFee: line(990) },
    };
  }
  return { ...base, payout: { ...payout, status: 'paid' } };
}

export default function PayoutDetailScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const tabBarMetrics = useTabBarMetrics(2);
  const { id } = useLocalSearchParams<{ id: string }>();
  const payoutId = typeof id === 'string' ? id : '';
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const isPreviewMode = isSellerDevPreview();
  const isPreview = (isPreviewMode && !userId) || (isPreviewMode && (!authLoaded || !isSignedIn));
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);

  const [detail, setDetail] = useState<PayoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (isPreview) {
      // Signed-out preview never calls the API; fake data only with &demo=1.
      setDetail(isPreviewDemoMode() && payoutId ? demoDetail(payoutId) : null);
      setLoadError(false);
      setLoading(false);
      return;
    }
    if (!payoutId) { setDetail(null); setLoading(false); return; }
    setLoading(true);
    setLoadError(false);
    try {
      setDetail(await api.finance.payoutDetail(payoutId));
    } catch (error: any) {
      if (error?.status === 404) setDetail(null);
      else setLoadError(true);
    }
    setLoading(false);
  }, [api, isPreview, payoutId]);

  useEffect(() => { void load(); }, [load]);

  const goBack = () => goBackOr(router, '/payouts' as never);

  if (!isPreview && isLoadingRole) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout" onBack={goBack} />
        <View style={{ padding: SP.md, gap: SP.sm }}><LoadingSkeleton height={96} /><LoadingSkeleton height={160} /></View>
      </View>
    );
  }
  if (!isPreview && !hasPayoutsAccess(currentRole) && !isReadOnly) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Payout" onBack={goBack} />
        <RoleLockedView screenTitle="payouts" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  const payout = detail?.payout ?? null;
  const rows = detail ? breakdownRows(detail) : [];
  const failed = payout?.status === 'failed' || payout?.status === 'canceled';
  const arrivalLabel = payout?.status === 'paid' ? 'Arrived' : failed ? 'Was due' : 'Arrives';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Payout" onBack={goBack} />
      <ScrollView
        style={{ marginBottom: tabBarMetrics.occupiedHeight }}
        contentContainerStyle={[styles.content, !payout && !loading && !loadError && { flexGrow: 1, justifyContent: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={{ gap: SP.sm }}><LoadingSkeleton height={96} /><LoadingSkeleton height={200} /></View>
        ) : loadError ? (
          <ErrorState message="Couldn't load this payout." onRetry={() => { void load(); }} />
        ) : !payout ? (
          <EmptyState icon="inbox" title="Payout not found" message="" compact />
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroAmount} testID="payout-detail-amount">{payout.formatted}</Text>
              <View style={[styles.pill, failed && { backgroundColor: `${theme.error}26` }]}>
                <Text style={[styles.pillText, failed && { color: theme.error }]} testID="payout-detail-status">
                  {payoutStatusLabel(payout.status)}
                </Text>
              </View>
            </View>

            <View style={styles.group}>
              <Row styles={styles} label={arrivalLabel} value={fmtDate(payout.arrivalDate)} first />
              <Row
                styles={styles}
                label={payout.method === 'instant' ? 'Debit card' : 'Bank account'}
                value={payout.destination?.last4 ? `${payout.destination.brand ? `${payout.destination.brand} ` : ''}···${payout.destination.last4}` : '—'}
              />
              <Row styles={styles} label="Initiated" value={fmtDate(payout.created)} />
              {payout.instantFee && <Row styles={styles} label="Instant fee" value={payout.instantFee.formatted} />}
              {failed && payout.failureMessage && <Row styles={styles} label="Reason" value={payout.failureMessage} />}
            </View>

            {rows.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Breakdown</Text>
                <View style={styles.group} testID="payout-detail-breakdown">
                  {rows.map((row, index) => (
                    <Row key={row.key} styles={styles} label={row.label} value={row.value} first={index === 0} strong={row.strong} />
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.note} testID="payout-detail-manual-note">
                This was a manual payout. It draws from your whole balance, so individual sales are not listed.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row(props: {
  styles: ReturnType<typeof createStyles>; label: string; value: string; first?: boolean; strong?: boolean;
}) {
  const { styles } = props;
  return (
    <View style={[styles.row, !props.first && styles.rowBorder]}>
      <Text style={[styles.rowLabel, props.strong && styles.rowStrong]}>{props.label}</Text>
      <Text style={[styles.rowValue, props.strong && styles.rowStrong]}>{props.value}</Text>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { text, muted, border, card } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: SP.md, paddingBottom: SP.lg },
    hero: { alignItems: 'center', paddingVertical: SP.lg, gap: SP.sm },
    heroAmount: { color: text, fontSize: 40, fontFamily: FONT.bold, letterSpacing: -0.5 },
    pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: border },
    pillText: { color: text, fontSize: FS.xs, fontFamily: FONT.medium },
    group: { backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, paddingHorizontal: SP.md, marginBottom: SP.md },
    sectionTitle: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, marginTop: SP.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: SP.md, gap: SP.md },
    rowBorder: { borderTopWidth: 1, borderTopColor: border },
    rowLabel: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular },
    rowValue: { color: text, fontSize: FS.sm, fontFamily: FONT.medium, flexShrink: 1, textAlign: 'right' },
    rowStrong: { color: text, fontFamily: FONT.semibold, fontSize: FS.base },
    note: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: SP.md },
  });
};
