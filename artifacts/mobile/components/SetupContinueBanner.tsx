/**
 * SetupContinueBanner — slim dashboard banner shown while the guided store
 * setup is incomplete and the walkthrough sheet has been dismissed. Tapping
 * it reopens the walkthrough. Persists until the seller reaches 100%.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

export default function SetupContinueBanner({
  percent,
  nextLabel,
  onPress,
}: {
  percent: number;
  nextLabel: string | null;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);

  return (
    <TouchableOpacity
      style={s.root}
      activeOpacity={0.85}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`Continue store setup, ${Math.round(percent)}% complete`}
    >
      <View style={s.ringTrack}>
        <View style={[s.ringFill, { width: `${Math.max(6, Math.min(100, percent))}%` }]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Continue setup · {Math.round(percent)}%</Text>
        <Text style={s.subtitle} numberOfLines={1}>
          {nextLabel ? `Next: ${nextLabel}` : 'A few steps left to finish your store'}
        </Text>
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
    </TouchableOpacity>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  ringTrack: {
    width: 34, height: 6, borderRadius: RADIUS.pill, backgroundColor: theme.border, overflow: 'hidden',
  },
  ringFill: { height: '100%', backgroundColor: theme.accent, borderRadius: RADIUS.pill },
  title: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
});
