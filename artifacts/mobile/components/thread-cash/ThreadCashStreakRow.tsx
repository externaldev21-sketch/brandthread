/**
 * A clean, premium 7-day streak card on the buyer's own profile — modeled on
 * the Duolingo/Apple Fitness style of streak row (see the Mobbin references
 * cited in this change's PR description): a title row with a single small
 * bill mark and the day count, then 7 evenly-spaced day columns with a
 * weekday letter above each. Completed days are a solid white circle with a
 * black check — never the Thread Cash bill artwork squashed into a tiny
 * circle, which read as cheap and cluttered. Today (not yet claimed) gets a
 * white ring; future days are a dim outline. Missing a calendar day resets
 * the streak to day 1 server-side (see computeCheckIn); after day 7 the next
 * claim starts a fresh week — this row always reflects exactly that state,
 * it never re-derives it locally.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, ICON } from '@/lib/theme';
import { ThreadCashBillIcon } from './ThreadCashBill';
import type { ThreadCashStreakState } from '@/lib/threadCashTypes';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Today's check gets a single settle-in (scale + fade, no overshoot — this
 * app's no-bounce standard, see PRESS_SPRING in constants/motion.ts) so
 * claiming it reads as a small confirmation instead of just appearing on
 * mount; every other already-claimed day renders its check straight in —
 * history shouldn't re-animate every time the card mounts.
 */
function TodayCheck() {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [progress]);
  return (
    <Animated.View style={{ opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
      <Feather name="check" size={16} color="#000000" /* theme-exempt: black check on the solid white circle */ />
    </Animated.View>
  );
}

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
    <Pressable
      style={({ pressed }) => [
        styles.wrap,
        { backgroundColor: '#141414' }, // theme-exempt: fixed dark card per spec
        pressed && onPress ? styles.wrapPressed : null,
      ]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Thread Cash streak, ${streak.currentStreak} day${streak.currentStreak === 1 ? '' : 's'}. Open Thread Cash wallet`}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ThreadCashBillIcon size={16} />
          <Text style={[styles.title, { color: theme.text }]}>Thread Cash streak</Text>
        </View>
        <View style={styles.subtitleRow}>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'}
          </Text>
          {onPress ? <Feather name="chevron-right" size={ICON.xs} color={theme.muted} /> : null}
        </View>
      </View>
      <View style={styles.daysRow} accessibilityLabel={`Day ${dayInCycle} of ${totalDays} in this Thread Cash week`}>
        {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
          const claimed = day <= claimedThroughDay;
          const isToday = day === dayInCycle;
          return (
            <View key={day} style={styles.dayCol}>
              <Text style={[styles.weekdayLabel, { color: theme.subtle }]}>{WEEKDAY_LETTERS[(day - 1) % 7]}</Text>
              <View
                style={[
                  styles.circle,
                  claimed
                    ? styles.circleClaimed
                    : isToday
                      ? styles.circleToday
                      : [styles.circleFuture, { borderColor: theme.borderSubtle }],
                ]}
              >
                {claimed ? (isToday ? <TodayCheck /> : <Feather name="check" size={16} color="#000000" /* theme-exempt: black check on the solid white circle */ />) : null}
              </View>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Card: 16pt side gutters (matching the rest of the page), 14 radius, 10pt
  // padding, with the days row 8pt below the title row.
  wrap: { marginHorizontal: SP.md, borderRadius: 12, padding: 9 },
  wrapPressed: { opacity: 0.75 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.medium },
  // No inter-column `gap` — `justifyContent: 'space-between'` alone spreads
  // all 7 columns evenly across the card's full width.
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayCol: { alignItems: 'center', gap: 3 },
  weekdayLabel: { fontSize: 11, fontFamily: FONT.semibold },
  circle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  circleClaimed: { backgroundColor: '#FFFFFF' /* theme-exempt: solid white completed mark per spec */ },
  circleToday: { borderWidth: 2, borderColor: '#FFFFFF' /* theme-exempt: white ring per spec */ },
  circleFuture: { borderWidth: 1 },
});
