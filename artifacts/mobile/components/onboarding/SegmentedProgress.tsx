/**
 * Onboarding progress: a row of thin straight segments, iOS style — 2pt
 * tall, silver fill for done and current steps, hairline track for the rest.
 * Replaces the drawn "thread" progress line.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';

export function SegmentedProgress({
  current,
  total,
  style,
}: {
  /** Zero-based index of the step on screen. */
  current: number;
  total: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const count = Math.max(1, total);
  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${Math.min(current + 1, count)} of ${count}`}
      accessibilityValue={{ min: 0, max: count, now: Math.min(current + 1, count) }}
      testID="onboarding-progress"
    >
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.segment, { backgroundColor: i <= current ? theme.muted : theme.border }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  segment: { flex: 1, height: 2, borderRadius: 1 },
});
