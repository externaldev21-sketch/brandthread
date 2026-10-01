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
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { BrandthreadScreen, BrandthreadCard, EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SkeletonBlock } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { TABULAR_NUMS, tabularType } from '@/constants/typography';
import { isBuyerDevPreview, isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewThreadCashStatus } from '@/lib/previewThreadCash';
import type { ThreadCashEntry, ThreadCashStatus } from '@/lib/threadCashTypes';
import { ThreadCashBill, ThreadCashBillStack, ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { goBackOr } from '@/lib/navigation/goBackOr';

function historyLabel(entry: ThreadCashEntry): string {
  switch (entry.source) {
    case 'daily_checkin': return 'Daily check-in';
    case 'streak_bonus': return 'Streak bonus';
    case 'referral': return 'Referral';
    case 'redemption': return 'Used at checkout';
    case 'checkout_spend': return 'Spent on an order';
    case 'refund_credit': return 'Returned from a refund';
    case 'expiry': return 'Expired';
    case 'send_sent': return 'Sent to a friend';
    case 'send_received': return 'Received from a friend';
    case 'send_cancelled': return 'Cancelled send, returned';
    case 'send_expired': return 'Unclaimed send, returned';
    case 'redemption_cancelled': return 'Returned from checkout';
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
    case 'referral': return { icon: 'users', color: theme.success };
    case 'redemption':
    case 'checkout_spend': return { icon: 'shopping-bag', color: theme.muted };
    case 'refund_credit':
    case 'redemption_cancelled': return { icon: 'rotate-ccw', color: theme.success };
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
// The status itself is the one shared fixture in lib/previewThreadCash.ts —
// the buyer profile's top-bar chip and streak card read the same values.
// Fresh install by default: $0.00, no streak, no history — the seeded
// $18.45/4-day-streak/transaction-history demo only appears under the
// explicit ?bt_preview=buyer&demo=1 opt-in.
const PREVIEW_HISTORY: ThreadCashEntry[] = [
  { id: 'p1', buyerId: 'preview', amountCents: 10, source: 'daily_checkin', referenceId: null, note: null, createdAt: new Date().toISOString() },
  { id: 'p7', buyerId: 'preview', amountCents: 1000, source: 'referral', referenceId: null, note: 'Referral welcome credit', createdAt: new Date(Date.now() - 0.5 * 864e5).toISOString() },
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
            <SkeletonBlock key={i} width={32} height={32} radius={16} />
          ))}
        </View>
      </View>
      <SkeletonBlock width={72} height={20} style={{ marginTop: SP.lg, marginBottom: SP.sm }} />
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <SkeletonBlock width={32} height={32} radius={16} />
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
  const insets = useSafeAreaInsets();
  const celebrateThreadCash = useCelebrateThreadCash();
  const [status, setStatus] = useState<ThreadCashStatus | null>(null);
  const [history, setHistory] = useState<ThreadCashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch must never render as a genuine "$0.00" balance — track it
  // separately so we can show a retry row instead of fabricating a zero.
  const [loadError, setLoadError] = useState(false);

  // Dev-only: a hidden long-press on the balance replays the money-burst
  // celebration on demand, so it can be screenshotted/recorded without
  // waiting on a real claim. Never present in a production build. Labeled
  // as a realistic source, not "Preview" — that string would otherwise show
  // up as visible "from Preview" text in the celebration toast itself.
  const previewBurst = useCallback(() => {
    if (!__DEV__) return;
    celebrateThreadCash({ amount: 500, from: 'Daily reward' });
  }, [celebrateThreadCash]);

  const load = useCallback(async () => {
    // Dev web preview only: the preview session has no real signed-in Clerk
    // user, so skip the network round-trip entirely and show clearly-labeled
    // placeholder data for UI review. No fake business numbers ever reach a
    // real signed-in account — this path is unreachable outside __DEV__ web
    // preview. Covers both roles: Thread Cash balances are shared between
    // buyers and sellers (sellers can send/receive it in seller-conversation
    // messages, same as buyers), and this app's own audit/e2e sandbox has no
    // real backend behind GET /api/thread-cash for either one.
    //
    // No artificial delay here (a `setTimeout` used to sit before resolving,
    // to "look" like a network round trip): a `setTimeout` started while a
    // navigation transition is still busy with synchronous/microtask render
    // work never got a turn on the event loop's macrotask queue and simply
    // never fired — this screen reached via a real in-app push (not a fresh
    // page load) hung on its loading skeleton forever, every time. Resolving
    // on a microtask instead means it always actually completes.
    if (isBuyerDevPreview() || isSellerDevPreview()) {
      setLoading(true);
      setLoadError(false);
      await Promise.resolve();
      setStatus(getPreviewThreadCashStatus());
      setHistory(isPreviewDemoMode() ? PREVIEW_HISTORY : []);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      const [s, h] = await Promise.all([api.threadCash.get(), api.threadCash.history(30)]);
      setStatus(s);
      setHistory(h.history);
    } catch {
      // Keep whatever was last shown, but flag the failure so the balance
      // never silently reads as a genuine "$0.00" when nothing loaded yet.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const streakBonusDays = status?.config.streakBonusDays ?? 7;
  const currentStreak = status?.streak.currentStreak ?? 0;
  const dayInCycle = status?.streak.dayInCycle ?? 1;
  const streakProgress = Math.min(1, dayInCycle / streakBonusDays);
  // Same rule as the profile's ThreadCashStreakRow: `dayInCycle` is today's
  // slot regardless of whether today has actually been claimed yet, so the
  // days that read as filled-in stop one short of it until
  // `alreadyCheckedInToday` is true. Using a plain `day <= dayInCycle` here
  // (as this screen previously did) could show one more day lit than the
  // profile does for the exact same streak state.
  const claimedThroughDay = status?.streak.alreadyCheckedInToday ? dayInCycle : dayInCycle - 1;

  return (
    <BrandthreadScreen scrollable noSafeTop>
      <ScreenHeader title="Thread Cash" onBack={() => goBackOr(router)} />
      {loading ? (
        <BalanceSkeleton styles={styles} />
      ) : (
          <View style={{ paddingHorizontal: SP.md, paddingBottom: Math.max(insets.bottom, SP.lg) }}>
            {/* Balance */}
            <BrandthreadCard glow style={styles.balanceCard}>
              {/* Hidden dev-only long-press to replay the money-burst celebration for screenshots. */}
              <Pressable onLongPress={previewBurst} disabled={!__DEV__}>
                <ThreadCashBillStack width={280} style={styles.balanceStack} />
              </Pressable>
              <Text style={[styles.balanceLabel, { color: theme.muted }]}>Your balance</Text>
              {loadError && status == null ? (
                <View style={{ marginTop: SP.sm, marginBottom: SP.xs }}>
                  <RetryRow label="Couldn't load balance" onRetry={() => void load()} />
                </View>
              ) : (
                <Text style={[styles.balanceValue, tabularType('display'), { color: theme.text }]}>
                  {formatCents(status?.balanceCents ?? 0)}
                </Text>
              )}
              <Text style={styles.balanceHint}>
                Thread Cash isn't money — it can't be cashed out or transferred for cash. Use it toward purchases in the app.
              </Text>
            </BrandthreadCard>

            {/* Streak row */}
            <BrandthreadCard style={styles.streakCard}>
              <View style={styles.streakHeading}>
                {/* Always the bill icon — never the coin — for Thread Cash. */}
                <ThreadCashBillIcon size={18} />
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

            {/* Same visual system as the profile's ThreadCashStreakRow, so
                both screens read as one design language: a bill icon for a
                claimed day, a ring for today, an outline with the plain day
                number for a day still ahead. */}
            <View style={styles.streakRow}>
              {Array.from({ length: streakBonusDays }, (_, i) => i + 1).map((day) => {
                const claimed = day <= claimedThroughDay;
                const isToday = day === dayInCycle;
                return (
                  <View
                    key={day}
                    style={[
                      styles.streakDay,
                      { borderColor: theme.borderSubtle, backgroundColor: theme.cardElevated },
                      claimed && { backgroundColor: theme.accentDim, borderColor: theme.accent },
                      isToday && { borderColor: theme.accent, borderWidth: 2 },
                    ]}
                  >
                    {claimed ? <ThreadCashBillIcon size={32} /> : (
                      <Text style={[styles.streakDayText, TABULAR_NUMS, { color: theme.subtle }]}>{day}</Text>
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
          {loadError && history.length === 0 ? (
            <RetryRow label="Couldn't load history" onRetry={() => void load()} />
          ) : history.length === 0 ? (
            <EmptyState
              compact
              icon="dollar-sign"
              title="No Thread Cash activity yet"
              description="Check in daily to start earning."
            />
          ) : (
            <View style={styles.historyList}>
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
                    <View style={[styles.historyIcon, { backgroundColor: theme.cardElevated }]}>
                      <Feather name={glyph.icon} size={16} color={glyph.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyLabel, { color: theme.text }]} numberOfLines={1}>{historyLabel(entry)}</Text>
                      <Text style={[styles.historyDate, { color: theme.subtle }]} numberOfLines={1}>
                        {new Date(entry.createdAt).toLocaleDateString()}
                        {entry.note ? ` · “${entry.note}”` : ''}
                      </Text>
                    </View>
                    <Text
                      style={[styles.historyAmount, TABULAR_NUMS, { color: entry.amountCents >= 0 ? theme.success : theme.text }]}
                      numberOfLines={1}
                    >
                      {entry.amountCents >= 0 ? '+' : '−'}{formatCents(Math.abs(entry.amountCents))}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Rules */}
            <Text style={[styles.sectionTitle, { color: theme.text }]}>How it works</Text>
            <BrandthreadCard style={styles.rulesCard}>
              {[
                'Keep the app open for a few active minutes a day to earn Thread Cash and build your streak',
                'Miss a calendar day and your streak resets to day 1 — no grace period',
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
  balanceCard: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20, marginTop: SP.sm },
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
  balanceLabel: { fontSize: 13, fontFamily: FONT.medium, color: theme.muted },
  // Balance snaps to the `display` type-scale role (44/48 Bold) via tabularType('display')
  // applied at the call site, rather than the old one-off fontSize: 40 (see design doc audit).
  balanceValue: { marginTop: 2 },
  balanceHint: {
    fontSize: 12, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 16,
    marginTop: SP.xs, paddingHorizontal: SP.md,
    color: 'rgba(255,255,255,0.7)', // theme-exempt: fixed dark hero card per spec
  },
  streakCard: { marginTop: SP.md },
  streakHeading: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  streakTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  streakCaption: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 1 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: SP.sm },
  progressFill: { height: '100%', borderRadius: 2 },
  // Same layout as the profile's ThreadCashStreakRow: fixed 32pt dots spread
  // by `justifyContent: space-between` alone, no inter-dot gap.
  streakRow: { flexDirection: 'row', justifyContent: 'space-between' },
  streakDay: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  streakDayText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  streakSub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.sm, lineHeight: 16 },
  sectionTitle: { fontSize: 20, fontFamily: FONT.semibold, marginTop: SP.lg, marginBottom: SP.sm },
  historyList: { marginBottom: SP.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.xs, minHeight: 60 },
  historyIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  historyLabel: { fontSize: FS.sm, fontFamily: FONT.medium },
  historyDate: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  historyAmount: { fontSize: FS.sm, fontFamily: FONT.semibold, textAlign: 'right' },
  rulesCard: { marginBottom: SP.lg, padding: 0, overflow: 'hidden' },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, paddingVertical: SP.sm, paddingHorizontal: SP.md },
  ruleDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  rulesText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20, flex: 1 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.xs, minHeight: 60 },
});
