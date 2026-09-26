/**
 * Thread Cash wallet — balance, streak, history, and the rules.
 * Thread Cash is a platform-funded reward credit: it can't be cashed out,
 * withdrawn, or converted to money — only spent toward purchases in the app.
 *
 * Visual layer only. Balance math, streak math, and the history/rules copy
 * all come from the same `api.threadCash.get()` / `.history()` calls as
 * before — nothing about eligibility, amounts, or business logic changed.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { BrandthreadScreen, BrandthreadHeader, BrandthreadCard, EmptyState } from '@/components/BrandthreadUI';
import { SkeletonBlock } from '@/components/ui';
import { TABULAR_NUMS, tabularType } from '@/constants/typography';
import { isBuyerDevPreview } from '@/lib/devPreview';
import type { ThreadCashEntry, ThreadCashStatus } from '@/lib/threadCashTypes';

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

/** Icon + tint per entry source, so the history list reads at a glance
 *  instead of every row looking the same. Purely presentational. */
function historyGlyph(
  entry: ThreadCashEntry,
  theme: AppThemePreset,
): { icon: React.ComponentProps<typeof Feather>['name']; color: string } {
  switch (entry.source) {
    case 'daily_checkin': return { icon: 'check-circle', color: theme.success };
    case 'streak_bonus': return { icon: 'zap', color: theme.accent };
    case 'redemption':
    case 'checkout_spend': return { icon: 'shopping-bag', color: theme.muted };
    case 'refund_credit': return { icon: 'rotate-ccw', color: theme.success };
    case 'expiry': return { icon: 'clock', color: theme.subtle };
    case 'send_sent': return { icon: 'arrow-up-right', color: theme.muted };
    case 'send_received': return { icon: 'arrow-down-left', color: theme.success };
    case 'send_cancelled':
    case 'send_expired': return { icon: 'corner-up-left', color: theme.subtle };
    default: return { icon: 'dollar-sign', color: theme.muted };
  }
}

// ─── Dev preview fallback ───────────────────────────────────────────────────
// Shown only when isBuyerDevPreview() is true AND the real API returns an
// error (no backend reachable in this preview). No fake business numbers are
// ever shown to a real signed-in buyer — this path is unreachable outside
// __DEV__ web preview. Mirrors the existing pattern in app/boost.tsx.
const PREVIEW_STATUS: ThreadCashStatus = {
  balanceCents: 1845,
  config: {
    dailyAmountCents: 10,
    streakBonusCents: 100,
    streakBonusDays: 7,
    graceHours: 20,
    expiryDays: 180,
    maxRedemptionPerOrderCents: 2000,
  },
  streak: {
    currentStreak: 4,
    longestStreak: 11,
    lastCheckInDate: new Date().toISOString(),
    timezone: 'UTC',
    alreadyCheckedInToday: true,
    dayInCycle: 4,
    streakBonusDays: 7,
  },
};
const PREVIEW_HISTORY: ThreadCashEntry[] = [
  { id: 'p1', buyerId: 'preview', amountCents: 10, source: 'daily_checkin', referenceId: null, note: null, createdAt: new Date().toISOString() },
  { id: 'p2', buyerId: 'preview', amountCents: 500, source: 'send_received', referenceId: null, note: 'For the drop', createdAt: new Date(Date.now() - 864e5).toISOString() },
  { id: 'p3', buyerId: 'preview', amountCents: -800, source: 'checkout_spend', referenceId: null, note: null, createdAt: new Date(Date.now() - 2 * 864e5).toISOString() },
  { id: 'p4', buyerId: 'preview', amountCents: 100, source: 'streak_bonus', referenceId: null, note: null, createdAt: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'p5', buyerId: 'preview', amountCents: -300, source: 'send_sent', referenceId: null, note: 'Congrats!', createdAt: new Date(Date.now() - 4 * 864e5).toISOString() },
  { id: 'p6', buyerId: 'preview', amountCents: 10, source: 'daily_checkin', referenceId: null, note: null, createdAt: new Date(Date.now() - 5 * 864e5).toISOString() },
];

function BalanceSkeleton({ styles }: { styles: Styles }) {
  return (
    <View style={{ paddingHorizontal: SP.md }}>
      <View style={styles.balanceCard}>
        <SkeletonBlock width={90} height={12} style={{ marginBottom: SP.sm }} />
        <SkeletonBlock width={160} height={40} radius={RADIUS.sm} />
        <SkeletonBlock width={220} height={12} style={{ marginTop: SP.md }} />
      </View>
      <View style={[styles.streakCard, { marginTop: SP.md }]}>
        <SkeletonBlock width={120} height={16} style={{ marginBottom: SP.md }} />
        <View style={styles.streakRow}>
          {Array.from({ length: 7 }, (_, i) => (
            <SkeletonBlock key={i} width={36} height={36} radius={RADIUS.sm} />
          ))}
        </View>
      </View>
      <SkeletonBlock width={72} height={14} style={{ marginTop: SP.lg, marginBottom: SP.sm }} />
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <SkeletonBlock width={36} height={36} radius={18} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock width="55%" height={13} />
            <SkeletonBlock width="30%" height={11} />
          </View>
          <SkeletonBlock width={50} height={14} />
        </View>
      ))}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

export default function ThreadCashScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const [status, setStatus] = useState<ThreadCashStatus | null>(null);
  const [history, setHistory] = useState<ThreadCashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingPreview, setUsingPreview] = useState(false);

  const load = useCallback(async () => {
    // Dev web preview only: the preview session has no real signed-in Clerk
    // user, so skip the network round-trip entirely and show clearly-labeled
    // placeholder data for UI review. No fake business numbers ever reach a
    // real signed-in buyer — this path is unreachable outside __DEV__ web
    // preview. Mirrors the existing pattern in app/boost.tsx.
    if (isBuyerDevPreview()) {
      setLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus(PREVIEW_STATUS);
      setHistory(PREVIEW_HISTORY);
      setUsingPreview(true);
      setLoading(false);
      return;
    }
    try {
      const [s, h] = await Promise.all([api.threadCash.get(), api.threadCash.history(30)]);
      setStatus(s);
      setHistory(h.history);
      setUsingPreview(false);
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
  const streakProgress = Math.min(1, dayInCycle / streakBonusDays);

  return (
    <BrandthreadScreen scrollable>
      <BrandthreadHeader title="Thread Cash" onBack={() => router.back()} />
      {loading ? (
        <BalanceSkeleton styles={styles} />
      ) : (
        <View style={{ paddingHorizontal: SP.md }}>
          {usingPreview && (
            <View style={styles.previewBanner}>
              <Feather name="eye" size={12} color={theme.subtle} />
              <Text style={styles.previewBannerText}>Preview data — not your real balance</Text>
            </View>
          )}

          {/* Balance */}
          <BrandthreadCard glow style={styles.balanceCard}>
            <View style={[styles.balanceIcon, { backgroundColor: theme.accentDim }]}>
              <Feather name="dollar-sign" size={ICON.md} color={theme.accent} />
            </View>
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
              <View style={[styles.streakFlame, { backgroundColor: theme.accentDim }]}>
                <Feather name="zap" size={16} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.streakTitle, { color: theme.text }]}>
                  {currentStreak > 0 ? `${currentStreak}-day streak` : 'Start your streak'}
                </Text>
                <Text style={[styles.streakCaption, { color: theme.muted }]}>
                  Day {Math.min(dayInCycle, streakBonusDays)} of {streakBonusDays}
                </Text>
              </View>
            </View>

            <View style={[styles.progressTrack, { backgroundColor: theme.borderSubtle }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: theme.accent, width: `${streakProgress * 100}%` },
                ]}
              />
            </View>

            <View style={styles.streakRow}>
              {Array.from({ length: streakBonusDays }, (_, i) => i + 1).map((day) => {
                const lit = day <= dayInCycle;
                const isBonusDay = day === streakBonusDays;
                return (
                  <View
                    key={day}
                    style={[
                      styles.streakDay,
                      { borderColor: theme.borderSubtle },
                      lit && { backgroundColor: theme.accent, borderColor: theme.accent },
                    ]}
                  >
                    {isBonusDay ? (
                      <Feather name="gift" size={14} color={lit ? theme.onAccent : theme.muted} />
                    ) : (
                      <Text style={[styles.streakDayText, TABULAR_NUMS, { color: lit ? theme.onAccent : theme.muted }]}>{day}</Text>
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
              description="Check in daily to start earning."
            />
          ) : (
            <BrandthreadCard style={styles.historyCard}>
              {history.map((entry, index) => {
                const glyph = historyGlyph(entry, theme);
                const isLast = index === history.length - 1;
                return (
                  <View
                    key={entry.id}
                    style={[
                      styles.historyRow,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
                    ]}
                  >
                    <View style={[styles.historyIcon, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
                      <Feather name={glyph.icon} size={16} color={glyph.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyLabel, { color: theme.text }]}>{historyLabel(entry)}</Text>
                      <Text style={[styles.historyDate, { color: theme.subtle }]}>
                        {new Date(entry.createdAt).toLocaleDateString()}
                        {entry.note ? ` · “${entry.note}”` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.historyAmount, TABULAR_NUMS, { color: entry.amountCents >= 0 ? theme.success : theme.muted }]}>
                      {entry.amountCents >= 0 ? '+' : '−'}{formatCents(Math.abs(entry.amountCents))}
                    </Text>
                  </View>
                );
              })}
            </BrandthreadCard>
          )}

          {/* Rules */}
          <Text style={[styles.sectionTitle, { color: theme.text }]}>How it works</Text>
          <BrandthreadCard style={styles.rulesCard}>
            {[
              'Check in once a day to earn Thread Cash and build your streak',
              'Missing a day may reset your streak — a short grace period is built in',
              "Thread Cash is not money: it can't be withdrawn, cashed out, or sent as cash",
              status?.config.expiryDays
                ? `Thread Cash expires ${status.config.expiryDays} days after it's earned`
                : "Thread Cash doesn’t expire",
            ].map((line, index, arr) => (
              <View
                key={line}
                style={[
                  styles.ruleRow,
                  index < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
                ]}
              >
                <View style={[styles.ruleDot, { backgroundColor: theme.accent }]} />
                <Text style={[styles.rulesText, { color: theme.muted }]}>{line}</Text>
              </View>
            ))}
          </BrandthreadCard>
        </View>
      )}
    </BrandthreadScreen>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  previewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    alignSelf: 'flex-start', marginBottom: SP.sm,
    paddingHorizontal: SP.sm, paddingVertical: 4,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.borderSubtle,
  },
  previewBannerText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.subtle },
  balanceCard: { alignItems: 'center', paddingVertical: SP.lg, marginTop: SP.sm },
  balanceIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.sm,
  },
  balanceLabel: { fontSize: FS.sm, fontFamily: FONT.medium },
  balanceValue: { marginTop: SP.xs },
  balanceHint: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.sm, paddingHorizontal: SP.md, lineHeight: 16 },
  streakCard: { marginTop: SP.md },
  streakHeading: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  streakFlame: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  streakTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  streakCaption: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 1 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: SP.sm },
  progressFill: { height: '100%', borderRadius: 2 },
  streakRow: { flexDirection: 'row', gap: SP.xs, justifyContent: 'space-between' },
  streakDay: { flex: 1, aspectRatio: 1, borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  streakDayText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  streakSub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.sm, lineHeight: 16 },
  sectionTitle: { fontSize: FS.md, fontFamily: FONT.semibold, marginTop: SP.lg, marginBottom: SP.sm },
  historyCard: { padding: 0, overflow: 'hidden' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, paddingHorizontal: SP.md, minHeight: 44 },
  historyIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  historyLabel: { fontSize: FS.sm, fontFamily: FONT.medium },
  historyDate: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  historyAmount: { fontSize: FS.sm, fontFamily: FONT.semibold },
  rulesCard: { marginBottom: SP.lg, padding: 0, overflow: 'hidden' },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, paddingVertical: SP.sm, paddingHorizontal: SP.md },
  ruleDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  rulesText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20, flex: 1 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
});
