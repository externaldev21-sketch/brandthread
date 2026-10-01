/**
 * LaunchChecklistCard — compact "Launch your store · x/8" card appended to the
 * seller dashboard. Shown only while the checklist is incomplete and not
 * dismissed; tapping opens the full checklist.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { hapticLight } from '@/lib/haptics';
import { LAUNCH_STEP_META, nextLaunchStep } from '@/lib/launchChecklist';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

export default function LaunchChecklistCard() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { checklist, dismiss } = useLaunchChecklist();

  if (!checklist || checklist.complete || checklist.dismissed) return null;
  const next = nextLaunchStep(checklist);

  return (
    <View style={s.root}>
      <PressableScale
        onPress={() => { hapticLight(); router.push('/launch-checklist' as never); }}
        accessibilityLabel={`Launch your store, ${checklist.doneCount} of ${checklist.total} done`}
        style={s.body}
      >
        <Text style={s.title}>Launch your store · {checklist.doneCount}/{checklist.total}</Text>
        <View style={s.track}>
          <View style={[s.fill, { width: `${(checklist.doneCount / checklist.total) * 100}%` }]} />
        </View>
        {next && (
          <View style={s.next}>
            <Text style={s.nextText}>Next: {LAUNCH_STEP_META[next].title}</Text>
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
          </View>
        )}
      </PressableScale>
      <View style={s.close}>
        <PressableScale onPress={dismiss} accessibilityLabel="Dismiss" hitSlop={10} noMinHeight style={s.closeBtn}>
          <Feather name="x" size={ICON.sm} color={theme.muted} />
        </PressableScale>
      </View>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: {
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: RADIUS.md, marginTop: SP.xl,
  },
  body: { padding: SP.md, gap: SP.sm },
  title: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text, paddingRight: SP.lg },
  close: { position: 'absolute', top: SP.sm, right: SP.sm },
  closeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, borderRadius: RADIUS.pill, backgroundColor: theme.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: RADIUS.pill, backgroundColor: theme.accent },
  next: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextText: { flex: 1, fontSize: FS.meta, fontFamily: FONT.regular, color: theme.muted },
});
