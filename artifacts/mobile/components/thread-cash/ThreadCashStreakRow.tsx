/**
 * A clean 7-dot/7-day streak row on the buyer's own profile: one dot per
 * day of the current Thread Cash week, the coin mark on every day already
 * claimed, and today's dot highlighted. Missing a calendar day resets the
 * streak to day 1 server-side (see computeCheckIn); after day 7 the next
 * claim starts a fresh week — this row always reflects exactly that state,
 * it never re-derives it locally.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { ThreadCashBillIcon } from './ThreadCashBill';
import type { ThreadCashStreakState } from '@/lib/threadCashTypes';

export function ThreadCashStreakRow({
  streak,
  onPress,
}: {
  streak: ThreadCashStreakState | null;
  /** Opens the Thread Cash wallet screen. */
  onPress?: () => void;
}) {
  const { theme } = useAppTheme();
  if (!streak || streak.currentStreak <= 0) return null;

  const totalDays = streak.streakBonusDays ?? 7;
  const dayInCycle = streak.dayInCycle;
  // `dayInCycle` is today's slot in the week regardless of whether today has
  // actually been claimed yet — so the days already *filled in* stop one
  // short of it until `alreadyCheckedInToday` is true.
  const claimedThroughDay = streak.alreadyCheckedInToday ? dayInCycle : dayInCycle - 1;

  return (
    <PressableScale
      style={styles.wrap}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Thread Cash streak, ${streak.currentStreak} day${streak.currentStreak === 1 ? '' : 's'}. Open Thread Cash wallet`}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Thread Cash streak</Text>
        <View style={styles.subtitleRow}>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'}
          </Text>
          {onPress ? <Feather name="chevron-right" size={ICON.xs} color={theme.muted} /> : null}
        </View>
      </View>
      <View style={styles.dotsRow} accessibilityLabel={`Day ${dayInCycle} of ${totalDays} in this Thread Cash week`}>
        {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
          const claimed = day <= claimedThroughDay;
          const isToday = day === dayInCycle;
          return (
            <View
              key={day}
              style={[
                styles.dot,
                { borderColor: theme.borderSubtle, backgroundColor: theme.cardElevated },
                claimed && { backgroundColor: theme.accentDim, borderColor: theme.accent },
                isToday && { borderColor: theme.accent, borderWidth: 2 },
              ]}
            >
              {claimed ? <ThreadCashBillIcon size={16} /> : (
                <Text style={[styles.dotText, { color: theme.subtle }]}>{day}</Text>
              )}
            </View>
          );
        })}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SP.md, paddingVertical: SP.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.medium },
  dotsRow: { flexDirection: 'row', gap: SP.xs, justifyContent: 'space-between' },
  dot: { width: 32, height: 32, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: FS.xs, fontFamily: FONT.semibold },
});
