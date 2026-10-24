/**
 * SetupContinueBanner — slim dashboard banner shown while the server launch
 * checklist is incomplete and its dashboard card is out of the way. Tapping
 * it opens the checklist. Persists until every step is done. The count is
 * lib/launchChecklist.ts `launchProgress`, the same one every setup prompt shows.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { Feather } from '@expo/vector-icons';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

export default function SetupContinueBanner({
  done,
  total,
  nextLabel,
  onPress,
}: {
  done: number;
  total: number;
  nextLabel: string | null;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const percent = total > 0 ? (done / total) * 100 : 0;

  return (
    <TouchableOpacity
      style={s.root}
      activeOpacity={0.85}
      onPress={() => onPress()}
      accessibilityRole="button"
      accessibilityLabel={`Continue store setup, ${done} of ${total} steps done`}
    >
      <View style={s.ringTrack}>
        <View style={[s.ringFill, { width: `${Math.max(6, Math.min(100, percent))}%` }]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Continue setup · {done}/{total}</Text>
        <Text style={s.subtitle} numberOfLines={1}>
          {nextLabel ? `Next: ${nextLabel}` : 'A few steps left to finish your store'}
        </Text>
      </View>
      <Icon name="chevron-right" size={ICON.sm} color={theme.muted} />
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
