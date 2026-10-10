import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';
import { RetryRow } from '@/components/ui/RetryRow';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { formatCents } from '@/lib/money';
import type { DisputeListItem } from '@/lib/disputeTypes';
import { demoDisputes } from '@/components/disputes/demoDisputes';
import { dueChipLabel, isFinalStatus, statusLabel } from '@/components/disputes/disputeUi';

type Filter = 'open' | 'closed';

const REASONS: Record<string, string> = {
  credit_not_processed: 'Refund not received',
  duplicate: 'Duplicate charge',
  fraudulent: 'Unauthorized charge',
  general: 'General dispute',
  product_not_received: 'Product not received',
  product_unacceptable: 'Not as described',
  subscription_canceled: 'Subscription canceled',
  unrecognized: 'Unrecognized charge',
};

/** Seller chargebacks: every dispute with its status and evidence due date. */
export default function DisputesScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const tabBar = useTabBarMetrics(2);
  const { userId } = useAuth();
  const signedOutPreview = isSellerDevPreview() && !userId;
  const [items, setItems] = useState<DisputeListItem[] | null>(signedOutPreview ? (isPreviewDemoMode() ? demoDisputes() : []) : null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const load = useCallback(async () => {
    if (signedOutPreview) return;
    setFailed(false);
    try {
      const rows = await api.disputes.list();
      setItems(rows.map((r: any) => ({
        id: r.id,
        orderId: r.orderId ?? null,
        orderNumber: r.orderNumber ?? null,
        amount: r.amount,
        currency: r.currency,
        reason: r.reason ?? null,
        status: r.status,
        evidenceDeadline: r.evidenceDeadline ?? null,
        evidenceSubmittedAt: r.evidenceSubmittedAt ?? null,
        createdAt: r.createdAt,
      })));
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOutPreview]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(
    () => (items ?? []).filter((d) => (filter === 'closed') === isFinalStatus(d.status)),
    [items, filter],
  );
  const openCount = (items ?? []).filter((d) => !isFinalStatus(d.status)).length;

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScreenHeader title="Chargebacks" />

      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(['open', 'closed'] as const).map((f) => {
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.tab, active && { borderBottomColor: colors.foreground }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, { color: active ? colors.foreground : colors.mutedForeground }]}>
                {f === 'open' ? `Open${openCount ? ` (${openCount})` : ''}` : 'Closed'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBar.occupiedHeight + SP.lg, flexGrow: 1 }}
      >
        {failed && !items ? (
          <View style={{ padding: SP.md }}>
            <RetryRow label="Couldn't load chargebacks" onRetry={() => void load()} />
          </View>
        ) : items === null ? (
          <View style={{ padding: SP.md, gap: SP.md }}>
            <LoadingSkeleton height={64} />
            <LoadingSkeleton height={64} />
            <LoadingSkeleton height={64} />
          </View>
        ) : shown.length === 0 ? (
          <EmptyState
            icon="shield"
            title={filter === 'open' ? 'No open chargebacks' : 'No closed chargebacks'}
            message={filter === 'open'
              ? 'When a customer disputes a payment, it shows up here.'
              : 'Won and lost chargebacks show up here.'}
          />
        ) : (
          shown.map((d) => {
            const due = !isFinalStatus(d.status) && !d.evidenceSubmittedAt && d.status !== 'under_review'
              ? dueChipLabel(d.evidenceDeadline)
              : null;
            const needsAction = d.status === 'needs_response' && !d.evidenceSubmittedAt;
            return (
              <TouchableOpacity
                key={d.id}
                activeOpacity={0.75}
                onPress={() => router.push(`/dispute-detail?disputeId=${encodeURIComponent(d.id)}` as never)}
                style={[styles.row, { borderBottomColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`${formatCents(Math.round(d.amount * 100))} chargeback, ${statusLabel(d.status)}`}
                testID={`dispute-row-${d.id}`}
              >
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.topLine}>
                    <Text style={[styles.amount, { color: colors.foreground }]}>
                      {formatCents(Math.round(d.amount * 100))}
                    </Text>
                    {d.orderNumber ? (
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{d.orderNumber}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {REASONS[d.reason ?? ''] ?? 'Dispute'}
                  </Text>
                  <View style={styles.chips}>
                    <View
                      style={[
                        styles.chip,
                        needsAction
                          ? { backgroundColor: colors.foreground, borderColor: colors.foreground }
                          : { borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: needsAction ? colors.background : colors.mutedForeground }]}>
                        {statusLabel(d.status)}
                      </Text>
                    </View>
                    {due ? (
                      <View style={[styles.chip, { borderColor: colors.border }]}>
                        <Feather name="clock" size={11} color={colors.mutedForeground} />
                        <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{due}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, marginHorizontal: SP.md },
  tab: { paddingVertical: SP.sm + 4, marginRight: SP.lg, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: FS.base, fontFamily: FONT.semibold },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: SP.sm },
  amount: { fontSize: FS.md, fontFamily: FONT.bold },
  meta: { fontSize: FS.sm, fontFamily: FONT.regular },
  chips: { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 5,
  },
  chipText: { fontSize: FS.meta, fontFamily: FONT.semibold },
});
