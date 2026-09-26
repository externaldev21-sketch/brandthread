/**
 * Thread Cash wallet — balance, streak calendar, history, and the rules.
 * Thread Cash is a platform-funded reward credit: it can't be cashed out,
 * withdrawn, or converted to money — only spent toward purchases in the app.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { BrandthreadScreen, BrandthreadHeader, BrandthreadCard, EmptyState } from '@/components/BrandthreadUI';
import { TABULAR_NUMS, tabularType } from '@/constants/typography';
import type { ThreadCashEntry, ThreadCashStatus } from '@/lib/threadCashTypes';
import { ThreadCashBillStack, ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';

function historyLabel(entry: ThreadCashEntry): string {
  switch (entry.source) {
    case 'daily_checkin': return 'Daily check-in';
    case 'streak_bonus': return 'Streak bonus';
    case 'redemption': return 'Used at checkout';
    case 'checkout_spend': return 'Spent on an order';
    case 'refund_credit': return 'Returned from a refund';
    case 'expiry': return 'Expired';
    case 'send_sent': return 'Sent to a friend';
    case 'send_received': return 'Received from a friend';
    case 'send_cancelled': return 'Cancelled send, returned';
    case 'send_expired': return 'Unclaimed send, returned';
    default: return 'Adjustment';
  }
}

export default function ThreadCashScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const api = useApi();
  const celebrateThreadCash = useCelebrateThreadCash();
  const [status, setStatus] = useState<ThreadCashStatus | null>(null);
  const [history, setHistory] = useState<ThreadCashEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Dev-only: a hidden long-press on the balance replays the money-burst
  // celebration on demand, so it can be screenshotted/recorded without
  // waiting on a real claim. Never present in a production build.
  const previewBurst = useCallback(() => {
    if (!__DEV__) return;
    celebrateThreadCash({ amount: 500, from: 'Preview' });
  }, [celebrateThreadCash]);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.threadCash.get(), api.threadCash.history(30)]);
      setStatus(s);
      setHistory(h.history);
    } catch {
      // Keep whatever was last shown; the screen still renders its chrome.
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const streakBonusDays = status?.config.streakBonusDays ?? 7;
  const currentStreak = status?.streak.currentStreak ?? 0;
  const dayInCycle = status?.streak.dayInCycle ?? 1;

  return (
    <BrandthreadScreen scrollable>
      <BrandthreadHeader title="Thread Cash" onBack={() => router.back()} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.accent} /></View>
      ) : (
          <View style={{ paddingHorizontal: SP.md }}>
            {/* Balance */}
            <BrandthreadCard glow style={styles.balanceCard}>
              {/* Hidden dev-only long-press to replay the money-burst celebration for screenshots. */}
              <Pressable onLongPress={previewBurst} disabled={!__DEV__}>
                <ThreadCashBillStack width={280} style={styles.balanceStack} />
              </Pressable>
              <Text style={[styles.balanceLabel, { color: theme.muted }]}>Your balance</Text>
              <Text style={[styles.balanceValue, tabularType('display'), { color: theme.text }]}>
                {formatCents(status?.balanceCents ?? 0)}
              </Text>
              <Text style={[styles.balanceHint, { color: theme.subtle }]}>
                Thread Cash isn't money — it can't be cashed out or transferred for cash. Use it toward purchases in the app.
              </Text>
            </BrandthreadCard>

            {/* Streak row */}
            <BrandthreadCard style={styles.streakCard}>
              <View style={styles.streakHeading}>
                <ThreadCashBillIcon size={18} />
                <Text style={[styles.streakTitle, { color: theme.text }]}>
                  {currentStreak > 0 ? `${currentStreak}-day streak` : 'Start your streak'}
                </Text>
              </View>
              <View style={styles.streakRow}>
                {Array.from({ length: streakBonusDays }, (_, i) => i + 1).map((day) => {
                  const lit = day <= dayInCycle;
                  return (
                    <View
                      key={day}
                      style={[
                        styles.streakDay,
                        { borderColor: theme.borderSubtle },
                        lit && { backgroundColor: theme.accentDim, borderColor: theme.accent },
                      ]}
                    >
                      {lit ? <ThreadCashBillIcon size={16} /> : (
                        <Text style={[styles.streakDayText, TABULAR_NUMS, { color: theme.muted }]}>{day}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={[styles.streakSub, TABULAR_NUMS, { color: theme.muted }]}>
                Longest streak: {status?.streak.longestStreak ?? 0} days · Earn ${(((status?.config.dailyAmountCents ?? 10)) / 100).toFixed(2)}/day,
                {' '}${(((status?.config.streakBonusCents ?? 100)) / 100).toFixed(2)} bonus every {streakBonusDays} days
              </Text>
            </BrandthreadCard>

            {/* History */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>History</Text>
            {history.length === 0 ? (
              <EmptyState
                compact
                icon="dollar-sign"
                title="No Thread Cash activity yet"
                description="Keep the app open a few minutes a day to start earning."
              />
            ) : (
              history.map((entry) => (
                <View key={entry.id} style={[styles.historyRow, { borderColor: theme.borderSubtle }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyLabel, { color: theme.text }]}>{historyLabel(entry)}</Text>
                    <Text style={[styles.historyDate, { color: theme.subtle }]}>
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={[styles.historyAmount, TABULAR_NUMS, { color: entry.amountCents >= 0 ? theme.success : theme.muted }]}>
                    {entry.amountCents >= 0 ? '+' : '−'}{formatCents(Math.abs(entry.amountCents))}
                  </Text>
                </View>
              ))
            )}

            {/* Rules */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>How it works</Text>
            <BrandthreadCard style={styles.rulesCard}>
              <Text style={[styles.rulesText, { color: theme.muted }]}>
                • Keep the app open for a few active minutes a day to earn Thread Cash and build your streak{'\n'}
                • Miss a calendar day and your streak resets to day 1 — no grace period{'\n'}
                • Thread Cash is not money: it can't be withdrawn, cashed out, or sent as cash{'\n'}
                {status?.config.expiryDays
                  ? `• Thread Cash expires ${status.config.expiryDays} days after it's earned`
                  : '• Thread Cash doesn’t expire'}
              </Text>
            </BrandthreadCard>
          </View>
      )}
    </BrandthreadScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  balanceCard: { alignItems: 'center', paddingVertical: SP.md, marginTop: SP.sm },
  // A small stack of two bills, fanned like the owner's stacked-bills art:
  // a duller, more-rotated bill behind, the crisp one tilted slightly on top.
  balanceStack: {
    marginBottom: SP.xs,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  balanceLabel: { fontSize: FS.sm, fontFamily: FONT.medium },
  // Balance snaps to the `display` type-scale role (44/48 Bold) via tabularType('display')
  // applied at the call site, rather than the old one-off fontSize: 40 (see design doc audit).
  balanceValue: { marginTop: 2 },
  balanceHint: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.xs, paddingHorizontal: SP.md },
  streakCard: { marginTop: SP.md },
  streakHeading: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: SP.sm },
  streakTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  streakRow: { flexDirection: 'row', gap: SP.xs, justifyContent: 'space-between' },
  streakDay: { flex: 1, aspectRatio: 1, borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  streakDayText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  streakSub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.sm },
  sectionTitle: { fontSize: FS.md, fontFamily: FONT.semibold, marginTop: SP.lg, marginBottom: SP.sm },
  emptyText: { fontSize: FS.sm, fontFamily: FONT.regular },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  historyLabel: { fontSize: FS.sm, fontFamily: FONT.medium },
  historyDate: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  historyAmount: { fontSize: FS.sm, fontFamily: FONT.semibold },
  rulesCard: { marginBottom: SP.lg },
  rulesText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
});
