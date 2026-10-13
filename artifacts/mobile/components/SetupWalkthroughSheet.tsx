/**
 * SetupWalkthroughSheet — guided, step-by-step store setup walkthrough.
 *
 * Shown automatically to a seller whose account is incomplete, and
 * reachable any time via the "Continue setup" dashboard banner. Built
 * entirely on top of the existing lib/setupStore.ts checklist (from the
 * merged onboarding PR) — no duplicate task list or completion logic.
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { withOrigin } from '@/lib/navigation/flowOrigin';
import { Sheet } from '@/components/ui/BottomSheet';
import { showActionSheet } from '@/components/ui/ActionSheet';
import {
  SetupState, SetupTask, SetupTaskId,
  completionPercent, nextTask, completedRequiredTaskCount, requiredTaskCount,
  markSetupStarted, dismissWelcome, skipTask,
} from '@/lib/setupStore';
import SetupProgressRing from '@/components/SetupProgressRing';

export default function SetupWalkthroughSheet({
  visible,
  onClose,
  userId,
  setupState,
  onSetupStateChange,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string | null | undefined;
  setupState: SetupState;
  onSetupStateChange: (next: SetupState) => void;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const s = useMemo(() => createStyles(theme), [theme]);

  const pct = completionPercent(setupState);
  const active = nextTask(setupState);
  const done = completedRequiredTaskCount(setupState);
  const total = requiredTaskCount(setupState);

  const handleClose = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = await dismissWelcome(userId);
    onSetupStateChange(next);
    onClose();
  }, [onClose, onSetupStateChange, userId]);

  const openTask = useCallback(async (task: SetupTask) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = await markSetupStarted(userId);
    onSetupStateChange(next);
    onClose();
    try {
      router.push(withOrigin(task.route, 'dashboard') as never);
    } catch { /* ignore */ }
  }, [onClose, onSetupStateChange, router, userId]);

  const handleSkip = useCallback((task: SetupTask) => {
    showActionSheet(
      `Skip "${task.label}"?`,
      'You can always come back to this later from the setup checklist.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: async () => {
            const next = await skipTask(task.id as SetupTaskId, userId);
            onSetupStateChange(next);
          },
        },
      ],
    );
  }, [onSetupStateChange, userId]);

  return (
    <Sheet
      visible={visible}
      onClose={() => { void handleClose(); }}
      title="Let's set up your store"
      testID="setup-walkthrough-sheet"
      primaryAction={{
        label: active ? `Continue: ${active.label}` : 'Done',
        onPress: () => { void (active ? openTask(active) : handleClose()); },
      }}
      secondaryAction={{ label: 'Continue setup later', onPress: () => { void handleClose(); }, variant: 'secondary' }}
    >
      <View style={s.header}>
        <SetupProgressRing
          percent={pct}
          trackColor={theme.border}
          fillColor={theme.accent}
          textColor={theme.text}
        />
        <Text style={s.subtitle}>
          {done} of {total} steps complete
          {active ? ` · Next: ${active.label}` : ''}
        </Text>
      </View>

      {setupState.tasks.map((task) => {
        const isActive = active?.id === task.id;
        const isSkipped = task.skipped && !task.completed;
        return (
          <TouchableOpacity
            key={task.id}
            activeOpacity={0.85}
            onPress={() => openTask(task)}
            style={[
              s.row,
              task.completed && s.rowDone,
              isActive && s.rowActive,
            ]}
          >
            <View style={[
              s.iconWrap,
              // Monochrome only: a completed step is told apart by the
              // solid accent fill + checkmark glyph, never a green tint
              // (this screen has none of the app's 3 allowed color
              // accents — LIVE-red, end-call-red, Thread Cash green).
              (task.completed || isActive) && { backgroundColor: theme.accent },
            ]}>
              <Feather
                name={task.completed ? 'check' : (task.icon as keyof typeof Feather.glyphMap)}
                size={ICON.sm}
                color={task.completed || isActive ? theme.onAccent : theme.muted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, (task.completed || isSkipped) && s.rowLabelMuted]} numberOfLines={1}>
                {task.label}{task.optional ? ' (optional)' : ''}
              </Text>
              <Text style={s.rowDesc} numberOfLines={1}>
                {isSkipped ? 'Skipped' : task.description}
              </Text>
            </View>
            {!task.completed && (
              <TouchableOpacity
                onPress={() => handleSkip(task)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Skip ${task.label}`}
              >
                <Text style={s.skip}>Skip</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}
    </Sheet>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.md },
  subtitle: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.sm, paddingHorizontal: SP.sm, borderRadius: RADIUS.md,
    marginBottom: SP.xs, borderWidth: 1, borderColor: 'transparent',
  },
  rowActive: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  rowDone: { opacity: 0.55 },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border,
  },
  rowLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  rowLabelMuted: { textDecorationLine: 'line-through', color: theme.muted },
  rowDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  skip: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.subtle },
});
