/**
 * MorningBriefCard: Apple Fitness Summary's dismissible top card (title row
 * with a close button, a short body, one wide action), in Brandthread's
 * black / white / silver. X hides it for today; ••• offers "Turn off morning
 * brief" for good. A menu rather than a long-press, because a long-press is
 * invisible and unreachable with VoiceOver, and the X has to stay "today
 * only" so tomorrow's brief can replace it.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PressableScale } from '@/components/BrandthreadUI';
import { showActionSheet } from '@/components/ui/ActionSheet';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { primaryActionLabel, summarySentence, type MorningBrief } from '@/lib/morningBrief';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

export default function MorningBriefCard({
  brief,
  theme,
  onAction,
  onDismiss,
  onTurnOff,
}: {
  brief: MorningBrief;
  theme: AppThemePreset;
  onAction: () => void;
  onDismiss: () => void;
  onTurnOff: () => void;
}) {
  const s = useMemo(() => createStyles(theme), [theme]);
  const suggestion = brief.suggestion;

  const openMenu = () => {
    showActionSheet(undefined, undefined, [
      { text: 'Turn off morning brief', style: 'destructive', onPress: onTurnOff },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={s.card} testID="morning-brief-card">
      <View style={s.titleRow}>
        <Text style={s.title} accessibilityRole="header">Morning brief</Text>
        <PressableScale onPress={openMenu} accessibilityLabel="Morning brief options" hitSlop={8} noMinHeight style={s.roundButton} testID="morning-brief-options">
          <Feather name="more-horizontal" size={15} color={theme.muted} />
        </PressableScale>
        <PressableScale onPress={onDismiss} accessibilityLabel="Hide for today" hitSlop={8} noMinHeight style={s.roundButton} testID="morning-brief-dismiss">
          <Feather name="x" size={15} color={theme.muted} />
        </PressableScale>
      </View>

      <Text style={s.body}>{summarySentence(brief, formatCents)}</Text>
      {suggestion && (
        <Text style={s.body} testID="morning-brief-suggestion">
          <Text style={s.suggestionTitle}>{suggestion.title}. </Text>
          {suggestion.detail}
        </Text>
      )}

      <PressableScale onPress={onAction} accessibilityRole="button" style={s.action} testID="morning-brief-action">
        <Text style={s.actionText}>{primaryActionLabel(brief)}</Text>
      </PressableScale>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: SP.md,
    gap: SP.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  title: { flex: 1, fontFamily: FONT.bold, fontSize: FS.md, color: theme.text, letterSpacing: -0.2 },
  roundButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, color: theme.muted },
  suggestionTitle: { fontFamily: FONT.semibold, color: theme.text },
  action: {
    marginTop: SP.sm,
    minHeight: 46,
    borderRadius: RADIUS.pill,
    backgroundColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.md,
  },
  actionText: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
});
