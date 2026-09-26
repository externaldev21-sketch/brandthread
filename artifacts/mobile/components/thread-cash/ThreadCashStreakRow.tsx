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
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ThreadCashCoin } from './ThreadCashBill';
import type { ThreadCashStreakState } from '@/lib/threadCashTypes';

export function ThreadCashStreakRow({ streak }: { streak: ThreadCashStreakState | null }) {
  const { theme } = useAppTheme();
  if (!streak || streak.currentStreak <= 0) return null;

  const totalDays = streak.streakBonusDays ?? 7;
  const dayInCycle = streak.dayInCycle;
  // `dayInCycle` is today's slot in the week regardless of whether today has
  // actually been claimed yet — so the days already *filled in* stop one
  // short of it until `alreadyCheckedInToday` is true.
  const claimedThroughDay = streak.alreadyCheckedInToday ? dayInCycle : dayInCycle - 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Thread Cash streak</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>
          {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'}
        </Text>
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
              {claimed ? <ThreadCashCoin size={16} /> : (
                <Text style={[styles.dotText, { color: theme.subtle }]}>{day}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SP.md, paddingVertical: SP.sm },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SP.xs },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.medium },
  dotsRow: { flexDirection: 'row', gap: SP.xs, justifyContent: 'space-between' },
  dot: { width: 32, height: 32, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: FS.xs, fontFamily: FONT.semibold },
});
