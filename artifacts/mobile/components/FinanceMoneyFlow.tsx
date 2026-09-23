import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import {
  activityLabel, buildMoneyTiles, deadlineText, dropOrdersText, dropStateLabel, isEmptySummary, signedCents,
  type FinanceSummary, type Tone,
} from '@/lib/financeSummary';

type Props = {
  summary: FinanceSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

function useToneColor() {
  const colors = useColors();
  return (tone: Tone) => tone === 'positive'
    ? colors.success
    : tone === 'caution'
      ? colors.warning
      : tone === 'negative'
        ? colors.destructive
        : colors.foreground;
}

/**
 * "Where is my money": held preorder funds, transfers on the way, the
 * Stripe balance, and everything paid out — from the money ledger and live
 * Stripe balance (GET /api/finance/summary). Never shows made-up numbers:
 * a figure that could not be loaded is shown as unavailable.
 */
export function FinanceMoneyFlow({ summary, loading, error, onRetry }: Props) {
  const colors = useColors();
  const toneColor = useToneColor();

  if (loading && !summary) {
    return (
      <View style={styles.grid} accessibilityLabel="Loading your balances">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.skeletonLine, { width: 54, backgroundColor: colors.secondary }]} />
            <View style={[styles.skeletonLine, { width: 88, height: 18, backgroundColor: colors.secondary }]} />
            <View style={[styles.skeletonLine, { width: 110, backgroundColor: colors.secondary }]} />
          </View>
        ))}
      </View>
    );
  }

  if (error && !summary) {
    return (
      <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="cloud-off" size={18} color={colors.mutedForeground} />
        <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn't load your balances</Text>
        <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>
          Your money is safe — this is only a display problem.
        </Text>
        <TouchableOpacity
          onPress={onRetry}
          style={[styles.retry, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Retry loading balances"
        >
          <Text style={[styles.retryText, { color: colors.foreground }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!summary) return null;

  const tiles = buildMoneyTiles(summary);
  const drops = summary.held.drops.filter((d) => d.escrowState !== null);

  return (
    <View>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View
            key={tile.key}
            style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}
            accessible
            accessibilityLabel={`${tile.label}: ${tile.value}. ${tile.caption}`}
          >
            <View style={styles.tileHead}>
              <Feather name={tile.icon} size={13} color={colors.mutedForeground} />
              <Text style={[styles.tileLabel, { color: colors.mutedForeground }]}>{tile.label}</Text>
            </View>
            <Text style={[styles.tileValue, { color: toneColor(tile.tone) }]} numberOfLines={1} adjustsFontSizeToFit>
              {tile.value}
            </Text>
            <Text style={[styles.tileCaption, { color: colors.mutedForeground }]} numberOfLines={2}>{tile.caption}</Text>
          </View>
        ))}
      </View>

      {summary.owed.amount > 0 && (
        <View style={[styles.notice, { borderColor: colors.warning, backgroundColor: colors.card }]}>
          <Feather name="alert-circle" size={16} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
              You owe Brandthread {formatCents(summary.owed.amount)}
            </Text>
            <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>
              Buyers were refunded after held money had already paid for production or shipping labels.
              Brandthread support will contact you to settle it.
            </Text>
          </View>
        </View>
      )}
      {summary.credit.amount > 0 && (
        <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="info" size={16} color={colors.mutedForeground} />
          <Text style={[styles.noticeBody, { color: colors.mutedForeground, flex: 1 }]}>
            Brandthread owes you {formatCents(summary.credit.amount)} (for example, a label you voided after it was
            charged). Support will send it to your Stripe account.
          </Text>
        </View>
      )}

      {drops.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Preorder drops</Text>
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {drops.map((drop, i) => {
              const state = dropStateLabel(drop.escrowState);
              const deadline = deadlineText(drop);
              return (
                <View
                  key={drop.dropId}
                  style={[styles.dropRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.dropName, { color: colors.foreground }]} numberOfLines={1}>{drop.name}</Text>
                    <Text style={[styles.dropMeta, { color: colors.mutedForeground }]}>{dropOrdersText(drop)}</Text>
                    {deadline && <Text style={[styles.dropMeta, { color: colors.mutedForeground }]}>{deadline}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={[styles.dropAmount, { color: drop.shortfallCents > 0 ? colors.destructive : colors.foreground }]}>
                      {drop.shortfallCents > 0 ? `−${formatCents(drop.shortfallCents)}` : formatCents(drop.heldCents)}
                    </Text>
                    <View style={[styles.pill, { borderColor: colors.border }]}>
                      <Text style={[styles.pillText, { color: toneColor(state.tone) }]}>{state.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Money activity</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: 20 }} />
        ) : isEmptySummary(summary) || summary.activity.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.stateBody, { color: colors.mutedForeground, textAlign: 'center' }]}>
              No sales yet. When a buyer pays, you'll see exactly where every dollar goes — fees, held preorder
              money, and payouts.
            </Text>
          </View>
        ) : (
          summary.activity.slice(0, 10).map((row, i) => (
            <View key={row.id} style={[styles.activityRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.activityName, { color: colors.foreground }]} numberOfLines={1}>
                  {activityLabel(row.kind, row.description)}
                </Text>
                <Text style={[styles.dropMeta, { color: colors.mutedForeground }]}>
                  {new Date(row.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
              <Text style={[styles.activityAmount, { color: row.sellerEffectCents > 0 ? colors.success : colors.foreground }]}>
                {signedCents(row.sellerEffectCents)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        Brandthread keeps 5% of each sale plus Stripe's processing fee. Preorder money is held until each order
        ships, then released for that order.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tile: { flexBasis: '48%', flexGrow: 1, borderRadius: 14, borderWidth: 1, padding: 12, gap: 6, minHeight: 104 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { fontSize: FS.xs, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.4 },
  tileValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  tileCaption: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 15 },
  skeletonLine: { height: 10, borderRadius: 5 },
  stateCard: { borderRadius: 14, borderWidth: 1, padding: 18, alignItems: 'center', gap: 8, marginBottom: 20 },
  stateTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  stateBody: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  retry: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
  retryText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  notice: { flexDirection: 'row', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 16 },
  noticeTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  noticeBody: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 20 },
  dropRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  dropName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  dropMeta: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  dropAmount: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  pill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  empty: { padding: 20 },
  activityRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  activityName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  activityAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  footnote: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16, marginBottom: 24 },
});
