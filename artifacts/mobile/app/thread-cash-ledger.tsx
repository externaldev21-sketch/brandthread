/**
 * Thread Cash ledger — every earn, spend and expiry with the balance after
 * each one, what expires soon, and filters. Layout follows Klarna's cashback
 * screen (big balance, sections by month, name/date left, amount right) with
 * Affirm's pill filter row. Real data only; the populated sample exists only
 * under the `&demo=1` dev preview. Buyers' own Thread Cash: the seller cash-out
 * ledger is thread-cash-history.tsx.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { SkeletonBlock } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { TABULAR_NUMS, tabularType } from '@/constants/typography';
import { isBuyerDevPreview, isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { ledgerLabel, groupLedgerByMonth, formatExpiryDate, LEDGER_FILTERS, demoLedger } from '@/lib/threadCashLedger';
import type { ThreadCashLedger, ThreadCashLedgerKind, ThreadCashLedgerRow } from '@/lib/threadCashTypes';

const EMPTY: ThreadCashLedger = {
  balanceCents: 0, expiryDays: null, expiringSoon: { totalCents: 0, nextExpiresAt: null, buckets: [] }, rows: [], hasMore: false,
};

const ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  daily_checkin: 'check-circle', streak_bonus: 'zap', redemption: 'shopping-bag', checkout_spend: 'shopping-bag',
  refund_credit: 'rotate-ccw', redemption_cancelled: 'rotate-ccw', expiry: 'clock', send_sent: 'arrow-up-right',
  send_received: 'arrow-down-left', send_cancelled: 'corner-up-left', send_expired: 'corner-up-left',
};

export default function ThreadCashLedgerScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ThreadCashLedgerKind | null>(null);
  const [data, setData] = useState<ThreadCashLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (kind: ThreadCashLedgerKind | null) => {
    setError(false);
    // Dev web preview has no signed-in user: never call the protected API.
    if (isBuyerDevPreview() || isSellerDevPreview()) {
      setData(isPreviewDemoMode() ? demoLedger(kind) : EMPTY);
      setLoading(false);
      return;
    }
    try {
      setData(await api.threadCash.ledger({ kind: kind ?? undefined }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(filter); }, [load, filter]));

  const loadMore = useCallback(async () => {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.threadCash.ledger({ kind: filter ?? undefined, offset: data.rows.length });
      setData({ ...data, rows: [...data.rows, ...next.rows], hasMore: next.hasMore });
    } catch {
      // The rows already shown stay; the next tap retries.
    } finally {
      setLoadingMore(false);
    }
  }, [api, data, filter, loadingMore]);

  const pick = (kind: ThreadCashLedgerKind | null) => { setFilter(kind); setLoading(true); };
  const soon = data?.expiringSoon;
  const groups = useMemo(() => groupLedgerByMonth(data?.rows ?? []), [data?.rows]);

  const renderRow = (row: ThreadCashLedgerRow, last: boolean) => {
    const credit = row.amountCents >= 0;
    return (
      <View key={row.id} style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle }]}>
        <View style={[styles.icon, { backgroundColor: theme.cardElevated }]}>
          <Feather name={ICONS[row.source] ?? 'dollar-sign'} size={16} color={credit ? theme.success : theme.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>{ledgerLabel(row.source)}</Text>
          <Text style={[styles.sub, { color: theme.subtle }]} numberOfLines={1}>
            {new Date(row.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {row.expiresAt && (row.remainingCents ?? 0) > 0 ? ` · expires ${formatExpiryDate(row.expiresAt)}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.amount, TABULAR_NUMS, { color: credit ? theme.success : theme.text }]} numberOfLines={1}>
            {credit ? '+' : '−'}{formatCents(Math.abs(row.amountCents))}
          </Text>
          <Text style={[styles.sub, TABULAR_NUMS, { color: theme.subtle }]} numberOfLines={1}>{formatCents(row.balanceAfterCents)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader hideDivider title="Ledger" onBack={() => goBackOr(router)} />
      <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, SP.lg) + SP.md }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={[styles.heroValue, tabularType('display'), { color: theme.text }]} testID="thread-cash-ledger-balance">
            {data ? formatCents(data.balanceCents) : '···'}
          </Text>
          <Text style={[styles.heroSub, { color: theme.muted }]}>
            {soon && soon.totalCents > 0 ? `${formatCents(soon.totalCents)} expires soon` : 'Thread Cash balance'}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {LEDGER_FILTERS.map((f) => {
            const active = f.kind === filter;
            return (
              <Pressable
                key={f.label}
                onPress={() => pick(f.kind)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.pill, { backgroundColor: active ? theme.text : theme.cardElevated }]}
              >
                <Text style={[styles.pillText, { color: active ? theme.background : theme.text }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={{ padding: SP.md, gap: SP.sm }}>
            {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} width="100%" height={56} radius={RADIUS.sm} />)}
          </View>
        ) : error && !data ? (
          <View style={{ padding: SP.md }}><RetryRow label="Couldn't load your ledger" onRetry={() => void load(filter)} /></View>
        ) : (
          <>
            {soon && soon.buckets.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Expiring soon</Text>
                {soon.buckets.map((b, i) => (
                  <View key={b.expiresAt} style={[styles.row, i < soon.buckets.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle }]}>
                    <View style={[styles.icon, { backgroundColor: theme.cardElevated }]}>
                      <Feather name="clock" size={16} color={theme.muted} />
                    </View>
                    <Text style={[styles.label, { color: theme.text, flex: 1 }]}>Expires {formatExpiryDate(b.expiresAt)}</Text>
                    <Text style={[styles.amount, TABULAR_NUMS, { color: theme.text }]}>{formatCents(b.amountCents)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {groups.length === 0 ? (
              <EmptyState
                compact
                icon="dollar-sign"
                title={filter ? 'Nothing here' : 'No Thread Cash activity yet'}
                description={filter ? 'Try another filter.' : 'Check in daily to start earning.'}
              />
            ) : groups.map((g) => (
              <View key={g.title} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>{g.title}</Text>
                {g.rows.map((row, i) => renderRow(row, i === g.rows.length - 1))}
              </View>
            ))}
            {data?.hasMore ? (
              <Pressable onPress={() => void loadMore()} style={styles.more} accessibilityRole="button">
                {loadingMore ? <ActivityIndicator color={theme.muted} /> : <Text style={[styles.pillText, { color: theme.text }]}>Show more</Text>}
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1 },
  hero: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.md },
  heroValue: {},
  heroSub: { fontFamily: FONT.medium, fontSize: FS.sm, marginTop: 4 },
  pills: { paddingHorizontal: SP.md, gap: SP.xs, paddingBottom: SP.sm },
  pill: { paddingHorizontal: 16, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  section: { paddingHorizontal: SP.md, marginTop: SP.md },
  sectionTitle: { fontFamily: FONT.semibold, fontSize: 20, marginBottom: SP.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 60, paddingVertical: SP.xs },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONT.medium, fontSize: FS.sm },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  amount: { fontFamily: FONT.semibold, fontSize: FS.sm },
  more: { alignItems: 'center', justifyContent: 'center', height: 48, marginTop: SP.sm },
});
