/**
 * Daily Thread Cash check-in sheet — shown at most once per buyer-local day,
 * the first time the buyer tab layout mounts that day. A 7-day (or however
 * many `streakBonusDays` the server configures) streak row lights up days as
 * they're completed, with today's day animating in.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import type { ThreadCashCheckInResult } from '@/lib/threadCashTypes';

export function CheckInSheet({
  visible,
  result,
  onClose,
}: {
  visible: boolean;
  result: ThreadCashCheckInResult | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const scale = useRef(new Animated.Value(0.9)).current;
  const todayScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scale.setValue(0.9);
    todayScale.setValue(0);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
    Animated.sequence([
      Animated.delay(200),
      Animated.spring(todayScale, { toValue: 1, useNativeDriver: true, friction: 5 }),
    ]).start();
  }, [visible, scale, todayScale]);

  if (!visible || !result) return null;

  const streakBonusDays = result.streak.streakBonusDays ?? 7;
  const dayInCycle = result.streak.dayInCycle;
  const totalEarned = result.earnedCents + result.streakBonusCents;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingBottom: insets.bottom }]}>
        <Animated.View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border, transform: [{ scale }] }]}>
          <View style={[styles.flame, { backgroundColor: theme.accentDim }]}>
            <Feather name="zap" size={28} color={theme.accent} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>
            {result.streakBroken ? 'New streak started!' : `${result.streak.currentStreak}-day streak!`}
          </Text>
          <Text style={[styles.earned, { color: theme.accent }]}>+{formatCents(totalEarned)} Thread Cash</Text>
          {result.streakBonusCents > 0 && (
            <Text style={[styles.bonus, { color: theme.muted }]}>Includes a {formatCents(result.streakBonusCents)} streak bonus!</Text>
          )}

          <View style={styles.streakRow}>
            {Array.from({ length: streakBonusDays }, (_, i) => i + 1).map((day) => {
              const lit = day <= dayInCycle;
              const isToday = day === dayInCycle;
              return (
                <Animated.View
                  key={day}
                  style={[
                    styles.day,
                    { borderColor: theme.borderSubtle },
                    lit && { backgroundColor: theme.accent, borderColor: theme.accent },
                    isToday && { transform: [{ scale: todayScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] }) }] },
                  ]}
                >
                  <Text style={[styles.dayText, { color: lit ? theme.onAccent : theme.muted }]}>{day}</Text>
                </Animated.View>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.accent }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss Thread Cash check-in"
          >
            <Text style={[styles.buttonText, { color: theme.onAccent }]}>Nice!</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000A0', alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  card: { width: '100%', maxWidth: 360, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.lg, alignItems: 'center' },
  flame: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  title: { fontSize: FS.lg, fontFamily: FONT.bold },
  earned: { fontSize: FS.xxl, fontFamily: FONT.bold, marginTop: SP.xs },
  bonus: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  streakRow: { flexDirection: 'row', gap: SP.xs, marginTop: SP.lg, marginBottom: SP.lg },
  day: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  button: { width: '100%', paddingVertical: SP.sm, borderRadius: RADIUS.md, alignItems: 'center' },
  buttonText: { fontSize: FS.base, fontFamily: FONT.semibold },
});
